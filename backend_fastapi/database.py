from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, Integer, String, Float, Text

DATABASE_URL = "sqlite+aiosqlite:///./data.db"
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

class Job(Base):
    __tablename__ = "jobs"
    id = Column(String, primary_key=True, index=True)
    status = Column(String, default="processing")
    total = Column(Integer, default=0)
    processed = Column(Integer, default=0)

class Lead(Base):
    __tablename__ = "leads"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    job_id = Column(String, index=True)
    query = Column(String)
    url = Column(String)
    phone = Column(String)
    email = Column(String)
    score = Column(Float)
    status = Column(String)
    reasons = Column(Text)
    proofs = Column(Text)
    category = Column(String)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
