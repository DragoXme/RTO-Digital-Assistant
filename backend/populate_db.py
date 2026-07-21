import os
import glob
import chromadb
import google.generativeai as genai
from chromadb.utils import embedding_functions

# Configure Gemini API client
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # Local fallback file lookup
    script_dir = os.path.dirname(os.path.abspath(__file__))
    key_path = os.path.join(script_dir, "api_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            GEMINI_API_KEY = f.read().strip()
genai.configure(api_key=GEMINI_API_KEY)

def populate_database():
    # Resolve absolute paths relative to script root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(script_dir, "rto_vector_db")
    docs_dir = os.path.join(script_dir, "rto_docs")
    
    print(f"Connecting to database at: {db_path}")
    chroma_client = chromadb.PersistentClient(path=db_path)
    
    # Define custom Gemini remote embedding helper
    class GeminiEmbeddingFunction(embedding_functions.EmbeddingFunction):
        def __call__(self, input):
            try:
                response = genai.embed_content(
                    model="models/gemini-embedding-001",
                    content=input,
                    task_type="retrieval_document"
                )
                return response['embedding']
            except Exception as e:
                print(f"Error generating embeddings: {e}")
                return [[0.0] * 3072 for _ in input]
                
    gemini_ef = GeminiEmbeddingFunction()
    
    # Initialize RTO database collection
    collection = chroma_client.get_or_create_collection(
        name="rto_rules", 
        embedding_function=gemini_ef
    )
    
    documents = []
    metadatas = []
    ids = []
    
    # Read RTO documentation source files
    text_files = glob.glob(os.path.join(docs_dir, "*.txt")) + glob.glob(os.path.join(docs_dir, "*.md"))
    
    if text_files:
        print(f"Found {len(text_files)} documentation files in {docs_dir}:")
        for filepath in text_files:
            filename = os.path.basename(filepath)
            print(f"  - Reading and chunking {filename}...")
            
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # Segment document by paragraph blocks
                chunks = [c.strip() for c in content.split("\n\n") if c.strip()]
                
                # Fallback line-split chunking if no paragraph blocks exist
                if len(chunks) <= 1:
                    chunks = [c.strip() for c in content.split("\n") if len(c.strip()) > 30]
                
                for idx, chunk in enumerate(chunks):
                    documents.append(chunk)
                    metadatas.append({"source": filename, "chunk_index": idx})
                    # Generate sanitized unique alphanumeric key
                    safe_name = "".join([c if c.isalnum() else "_" for c in filename])
                    ids.append(f"file_{safe_name}_{idx}")
            except Exception as e:
                print(f"  Error reading {filename}: {e}")
    else:
        print(f"\nNo text files (.txt or .md) found in {docs_dir}.")
        # Use default fallback dataset if no source files are present
        
        documents = [
            # --- License Topics ---
            "Learner's License (LL) fee in Uttarakhand is Rs. 150 for test and Rs. 150 for issuance. Total fee is Rs. 300.",
            "Permanent Driving License (DL) fee is Rs. 200 for test and Rs. 200 for issuance. Total fee is Rs. 400. Driving test is mandatory.",
            "To apply for a Learner's License in Uttarakhand, you must submit Form 1 (medical self-declaration), Form 2 (application), Address Proof (Aadhaar, Passport), and Age Proof (10th marksheet, birth certificate). Minimum age is 18 years for gear vehicles, and 16 years for gearless up to 50cc.",
            "Driving License renewal must be done within 1 year before or after expiry. Fee is Rs. 200 plus Rs. 200 for smart card. Total Rs. 400.",
            
            # --- Registration Certificate (RC) ---
            "Temporary vehicle registration is valid for 1 month only and cannot be renewed except under special circumstances. Fee is Rs. 100.",
            "Permanent RC renewal (for vehicles older than 15 years) fee is Rs. 600 for cars and Rs. 300 for two-wheelers. Renewal is valid for 5 years.",
            "Transfer of vehicle ownership (RC Transfer) requires Form 29 and 30, along with the Original RC, Insurance, Pollution Under Control (PUC) certificate, address proof of buyer, and applicable fee (Rs. 150 for two-wheelers, Rs. 300 for cars).",
            
            # --- Challans & Testing ---
            "Uttarakhand RTO driving test slots can be booked online via Sarathi portal. A slot booking is valid only for the selected date and time at the selected Dehradun/RTO center.",
            "Traffic challan payments can be checked and paid online using the Parivahan e-Challan portal (echallan.parivahan.gov.in) using vehicle number, DL number, or Challan number.",
        ]
        
        metadatas = [
            {"topic": "license_fee"},
            {"topic": "license_fee"},
            {"topic": "apply_learner"},
            {"topic": "license_renewal"},
            {"topic": "rc_temporary"},
            {"topic": "rc_renewal"},
            {"topic": "rc_transfer"},
            {"topic": "test_slot"},
            {"topic": "challan_pay"},
        ]
        
        ids = [f"rto_doc_{i}" for i in range(len(documents))]
    
    # Write/upsert data points to vector database
    if documents:
        print(f"Upserting {len(documents)} documents into 'rto_rules' collection...")
        collection.upsert(
            documents=documents,
            metadatas=metadatas,
            ids=ids
        )
        print("\nSuccessfully updated database!")
        print(f"Current total document count: {collection.count()}")
    else:
        print("No documents were prepared to be inserted.")

if __name__ == "__main__":
    populate_database()
