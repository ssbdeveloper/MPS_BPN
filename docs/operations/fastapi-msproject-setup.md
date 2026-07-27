---
tags: [domain/msproject]
---

hapus
rm -rf venv
rmdir /s /q venv


create
python3 -m venv venv

masuk
source venv/bin/activate
venv\Scripts\activate

pip install -r requirement.txt

python -m ensurepip
python -m pip install --upgrade pip

pip install fastapi uvicorn psycopg2-binary python-dotenv
