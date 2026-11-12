import base64
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from curl_cffi.requests import AsyncSession

session: AsyncSession = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global session
    session = AsyncSession(impersonate="chrome145")
    yield
    await session.close()

app = FastAPI(lifespan=lifespan)

class RequestPayload(BaseModel):
    url: str
    method: str = "GET"
    headers: dict = Field(default_factory=dict)
    cookies: dict = Field(default_factory=dict)
    data: str | None = None
    is_binary_data: bool = False

@app.post("/fetch")
async def make_request(req: RequestPayload):
    body = None

    if req.data:
        body = base64.b64decode(req.data) if req.is_binary_data else req.data.encode()

    try:
        async with AsyncSession(impersonate="chrome145") as s:
            response = await s.request(
                method=req.method.upper(),
                url=req.url,
                headers=req.headers,
                cookies=req.cookies,
                data=body,
            )

        return {
            "statusCode": response.status_code,
            "headers": dict(response.headers),
            "body": base64.b64encode(response.content).decode("utf-8"),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))