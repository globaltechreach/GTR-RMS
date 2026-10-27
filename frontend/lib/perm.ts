import type { AuthUser, Permission, Role } from "./types";

/** Default rights granted when creating a user with that role (mirrors backend ROLE_DEFAULTS). */
export const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  admin: ["pos", "kitchen", "discount", "returns", "reports", "inventory", "customers", "orders", "purchasing", "settings", "team"],
  manager: ["pos", "kitchen", "discount", "returns", "reports", "inventory", "customers", "orders", "purchasing", "settings", "team"],
  cashier: ["pos", "discount", "returns", "customers"],
  waiter: ["pos", "customers", "orders"],
  kitchen: ["kitchen"],
  franchisor: ["reports"],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter / Server",
  kitchen: "Kitchen",
  franchisor: "Franchisor (read-only)",
};

// Mirrors backend hasPerm(): admin & manager can do everything; franchisor is
// reports-only; everyone else needs the named right on their account.
export function can(user: AuthUser | undefined, perm: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "manager") return true;
  if (user.role === "franchisor") return perm === "reports";
  return user.permissions.includes(perm);
}

/** Whether this role may open the staff Team page / manage logins. */
export function canManageTeam(user: AuthUser | undefined): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return can(user, "team");
}
