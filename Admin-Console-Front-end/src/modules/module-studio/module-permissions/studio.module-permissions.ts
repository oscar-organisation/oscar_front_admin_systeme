import { DEPLOYMENT_STUDIO_PERMISSIONS } from "../features/deployment-studio/feature-permissions/deploymentStudio.permissions";

export const STUDIO_MODULE_PERMISSIONS = {
  ACCESS: "studio:access",
} as const;

export const STUDIO_PAGE_PERMISSIONS = [
  DEPLOYMENT_STUDIO_PERMISSIONS.PAGE,
] as const;
