# syntax=docker/dockerfile:1.7
# Python 3.12 rather than 3.13: OCR engine wheels lag behind new CPython releases.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# libgomp/libglib for onnxruntime + OpenCV; tesseract as the fallback engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 tesseract-ocr \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt && useradd --system --uid 10001 ocr
COPY app ./app
COPY samples ./samples
# Load the OCR models at build time so the first request is fast and nothing is fetched at runtime.
RUN python -c "from app.engines import engine; print('engine:', engine().name)"
USER ocr
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
