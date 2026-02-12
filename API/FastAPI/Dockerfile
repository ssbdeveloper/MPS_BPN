FROM python:3.11-slim

WORKDIR /app

# copy dulu requirements kalau ada
COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

# copy semua source fastapi
COPY . .

EXPOSE 8000

# sama persis seperti kamu jalanin manual
CMD ["python3", "main.py"]
