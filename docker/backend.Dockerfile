FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    graphviz \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY citation-network-backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY citation-network-backend/ .

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV MODULE_NAME=app
ENV VARIABLE_NAME=app
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]