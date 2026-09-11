// Compatibility facade while legacy pages migrate to feature-local policies.
export { canAny, canSee, evaluatePolicy, hasPermission } from "@/shared/kernel/permissions";
export { ADMINISTRATION_PAGE_PERMISSIONS as ADMIN_UI_FEATURES } from "@/modules/module-administration/module-permissions";
