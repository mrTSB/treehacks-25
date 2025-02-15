To get started:

python -m venv venv

# On Windows:
venv\Scripts\activate
# On Unix or MacOS:
source venv/bin/activate

pip install -r requirements.txt

uvicorn app:app --reload