To get started:

python -m venv venvlayerone

# On Windows:
venvlayerone\Scripts\activate
# On Unix or MacOS:
source venv/bin/activate

pip install -r requirements.txt

uvicorn app:app --reload