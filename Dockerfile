FROM node:22-bookworm-slim

ENV PYTHON_BIN=/opt/venv/bin/python
ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY crawler/requirements.txt ./crawler/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r crawler/requirements.txt \
    && /opt/venv/bin/crawl4ai-setup

COPY . .

CMD ["npm", "run", "start:api"]
