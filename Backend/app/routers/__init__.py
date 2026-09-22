from fastapi import APIRouter

from . import (
    ai, audit, auth, iam, organisations, presets, releases, roles, robots, sites, studio,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(organisations.router)
api_router.include_router(sites.router)
api_router.include_router(users.router)
api_router.include_router(roles.router)
api_router.include_router(iam.router)
api_router.include_router(robots.router)
api_router.include_router(ai.router)
api_router.include_router(studio.router)
api_router.include_router(presets.router)
api_router.include_router(releases.router)
api_router.include_router(audit.router)
