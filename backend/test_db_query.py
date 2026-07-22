import os
import chromadb
import google.generativeai as genai
from chromadb.utils import embedding_functions

# Configure Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    key_path = os.path.join(script_dir, "api_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            GEMINI_API_KEY = f.read().strip()
genai.configure(api_key=GEMINI_API_KEY, transport='rest')

try:
    print("Connecting to ChromaDB...")
    chroma_client = chromadb.PersistentClient(path="./backend/rto_vector_db")
    
    class GeminiEmbeddingFunction(embedding_functions.EmbeddingFunction):
        def __call__(self, input):
            print(f"Generating embeddings for: {input}")
            response = genai.embed_content(
                model="models/gemini-embedding-001",
                content=input,
                task_type="retrieval_document"
            )
            return response['embedding']
            
    gemini_ef = GeminiEmbeddingFunction()
    
    print("Getting collection 'rto_rules'...")
    collection = chroma_client.get_or_create_collection(name="rto_rules", embedding_function=gemini_ef)
    
    print(f"Current total document count: {collection.count()}")
    
    print("Running test query: 'how to get a driving license'...")
    results = collection.query(
        query_texts=["how to get a driving license"],
        n_results=2
    )
    print("\nQuery results:")
    for idx, doc in enumerate(results['documents'][0]):
        print(f"\nMatch {idx+1}:")
        print(doc[:200] + "...")
except Exception as e:
    print("Error:", e)
