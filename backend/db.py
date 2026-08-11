"""MongoDB client and database handle."""
import os
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Load env once, at import time
load_dotenv(Path(__file__).parent / ".env")

mongo_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = mongo_client[os.environ["DB_NAME"]]
