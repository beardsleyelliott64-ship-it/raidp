# EAM + Sentinel combined source bundle

This archive preserves the complete EAM project from `fixed real real(1).zip` at the project root, including its original commands, account handlers, web dashboard, Sparx modules, config, tools, tests, and deployment files. The Sentinel AI security bot source is preserved separately in `sentinel-addon/` so its files do not overwrite EAM files with the same names.

## Railway entry point
The root `package.json` remains EAM's original package and starts `launcher.js`. The EAM dashboard now answers both `/health` and `/api/health`, matching the root `railway.json` health check.

## Important integration note
The two original codebases are both included, but Sentinel's separate Discord command handlers have not been silently grafted into EAM's existing Discord client. `sentinel-addon/` is preserved as the Sentinel source to avoid breaking EAM's existing login, commands, database handlers, or Sparx features. Full runtime integration of Sentinel's anti-raid commands into EAM still requires a deliberate code merge and testing.

## Deploy
1. Upload the contents of this archive to the GitHub repository used by Railway.
2. Keep EAM's root `package.json` and `launcher.js` as the Railway start target (`npm start`).
3. Configure the environment variables from `.env.example` in Railway. Do not commit real tokens or keys.
4. Redeploy and check `/health`.

The Sparx Microsoft login and gRPC package-data issue are not claimed as fixed by this packaging/health-check change; the included original diagnostic notes and source are retained for targeted debugging.
