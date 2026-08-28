import sys, os
sys.path.insert(0, "/app/backend")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("JWT_SECRET", "x")
# Simulasikan server TANPA emergentintegrations (seperti server user Python 3.13)
sys.modules["emergentintegrations"] = None
sys.modules["emergentintegrations.llm"] = None
sys.modules["emergentintegrations.llm.chat"] = None
from routers import hrd_ai  # noqa
print("OK: routers.hrd_ai ter-import tanpa emergentintegrations (server boot normal)")
from fastapi import HTTPException
try:
    hrd_ai._llm_imports()
    print("GAGAL: seharusnya melempar HTTPException")
except HTTPException as e:
    print(f"OK: fitur AI degrade rapi -> HTTP {e.status_code} | {e.detail[:60]}...")
