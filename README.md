# Market Analysis MVP (Monorepo)

Fullstack MVP для анализа статусов рынка без торговых сигналов.

## Стек
- Backend: Node.js 20+, TypeScript, Fastify
- Frontend: Vite + React + TypeScript
- График: `tradingview/lightweight-charts`
- Данные: Binance Futures USDT-M (`fapi`)
- Реалтайм: Binance WS (kline 1h) + WS backend → frontend

## Структура
```
/apps/backend
/apps/frontend
/packages/shared
```

## Быстрый запуск (Docker)
```bash
docker-compose up --build
```

Откройте: http://localhost:5173

## Запуск без Docker
> Требуется Node.js 20+

```bash
npm install
npm --workspace apps/backend run dev
```

В отдельном терминале:
```bash
npm --workspace apps/frontend run dev
```

Frontend доступен на http://localhost:5173
Backend API на http://localhost:3001

## API
- `GET /api/symbols`
- `GET /api/candles?symbol=BTCUSDT&tf=1H&limit=500`
- `GET /api/analysis?symbol=BTCUSDT`
- `WS /ws?symbol=BTCUSDT` события: `candles_update`, `analysis_update`

## MVP логика
- **Dealing Range (DR)**: 1D, high/low за последние 180 свечей, EQ = 0.5.
- **PD state**: premium/discount/eq относительно DR EQ.
- **Fractals**: pivot high/low на 1D/4H (high/low выше/ниже 2 слева и 2 справа).
- **POI**: ближайший fractal high (sell) или fractal low (buy) на 4H.
- **Touch**: цена в пределах POI ± epsilon (0.1%).
- **VC (1H)**:
  - displacement: тело свечи > 1.2 * ATR(14) и закрытие за последний swing (fractals 1H)
  - или FVG: `high[i-2] < low[i]` (sell) / `low[i-2] > high[i]` (buy)
- **POI state**: candidate → touched → confirmed, иначе invalidated.
- **Structure**: сильный экстремум 4H, invalidated если пробит против направления.
- **Execution**: allowed если narrative defined (для MVP всегда true), PD соответствует направлению, POI confirmed, structure intact.
- **NextAction**: строка состояния.

## Допущения MVP
- Реалтайм обновляется только для TF 1H через Binance WS.
- POI рисуется как диапазон из двух линий (верх/низ), т.к. lightweight-charts не имеет нативных прямоугольников.
- Ошибки Binance обрабатываются с экспоненциальным backoff (3 попытки) и кэшем in-memory (30s).

## Проверка
1. Запустите `docker-compose up --build`.
2. Откройте http://localhost:5173, по умолчанию BTCUSDT 1H.
3. Переключение TF обновляет график.
4. При закрытии 1H свечей статусы обновляются через WS.
