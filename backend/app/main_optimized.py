"""
Streamlined Cyber Weather FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import time
import logging

from .core.config import get_settings, get_cors_origins
from .core.database import Base, engine, db_manager
from .routers.unified import router as unified_router

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Create database tables
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description="Real-time cyber threat forecasting using Hawkes processes",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Middleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware for request timing
@app.middleware("http")
async def add_process_time_header(request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

# Exception handlers
@app.exception_handler(404)
async def not_found_handler(request, exc):
    return JSONResponse(
        status_code=404,
        content={"error": "Endpoint not found", "path": str(request.url.path)}
    )

@app.exception_handler(500)
async def internal_error_handler(request, exc):
    logger.error(f"Internal error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "message": "Please try again later"}
    )

# Health endpoints
@app.get("/health")
@app.get("/healthz")
def health_check():
    """Comprehensive health check"""
    db_info = db_manager.get_connection_info()
    return {
        "status": "healthy",
        "service": "cyber-weather-api",
        "version": settings.api_version,
        "database": {
            "connected": True,
            "pool_info": db_info
        },
        "timestamp": time.time()
    }

@app.get("/")
def root():
    """Root endpoint with API information"""
    return {
        "service": "Cyber Weather Forecast API",
        "version": settings.api_version,
        "description": "Real-time cyber threat forecasting using Hawkes processes",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "unified_data": "/v1/data",
            "advisories": "/v1/advisories",
            "legacy": {
                "nowcast": "/v1/nowcast",
                "forecast": "/v1/forecast", 
                "params": "/v1/params"
            }
        }
    }

# Include routers
app.include_router(unified_router)

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info(f"🌐 Cyber Weather API v{settings.api_version} starting up")
    logger.info(f"📊 Database: {settings.database_url}")
    logger.info(f"🔧 Configuration loaded successfully")

# Shutdown event  
@app.on_event("shutdown")
async def shutdown_event():
    logger.info("👋 Cyber Weather API shutting down")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=settings.server_reload
    )