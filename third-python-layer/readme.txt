To get started:

python -m venv venvlayerthree

# On Windows:
venvlayerthree\Scripts\activate
# On Unix or MacOS:
source venv/bin/activate

pip install -r requirements.txt

uvicorn app:app --reload --port 8003