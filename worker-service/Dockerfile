FROM node:22-bookworm-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY worker-service/requirements.txt /tmp/worker-requirements.txt
COPY data-pipeline/requirements.txt /tmp/pipeline-requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/worker-requirements.txt -r /tmp/pipeline-requirements.txt
COPY . .
EXPOSE 8200
CMD ["python3", "-m", "uvicorn", "--app-dir", "worker-service", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
