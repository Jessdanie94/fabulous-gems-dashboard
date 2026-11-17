# Jesse Autopilot Bridge

Python (FastAPI) service for automated social marketing and payout/ledger tooling. Deployed on Render (`render.yaml`).

## Layout

- `main.py` – FastAPI app: `/`, `/healthz`, `/api/wise/webhook`, `/cron/rss-post`
- `routers/admin.py` – Sellvia API key rotation (`/admin/sellvia`)
- `auto_social_poster.py` – daily social poster (Render cron, 12:00 UTC)
- `rss_social_publisher.py`, `ayrshare_api_retriever.py` – social publishing helpers
- `sellvia_client.py`, `check_payouts.py` – Sellvia client and payout checks
- `create_ledger.py`, `tax_summary.py`, `utils/allocate.py`, `2026_cra_ledger.csv` – ledger and tax tooling
- `config.py` – settings loaded from environment variables

## Run locally

```
pip install -r requirements.txt
cp .env.example .env   # fill in values
uvicorn main:app --reload
```

## Environment variables

See `.env.example`. `main.py` also reads `ANTHROPIC_API_KEY`, `SELLVIA_RSS_URL` and `CRON_SECRET`.
