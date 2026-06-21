FROM python:3.11-slim

# Faster, quieter Python in containers
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt ./
RUN pip install -r requirements.txt

# App code (alembic.ini + alembic/ are needed for migrations on boot)
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY seed.py ./
COPY docker-entrypoint.sh ./

# Uploaded files live here (mounted as a volume in compose)
RUN mkdir -p uploads && chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
