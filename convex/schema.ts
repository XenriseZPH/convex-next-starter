import numbers from "@/convex/numbers/schema";
import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";

export default defineSchema({
  ...authTables,
  numbers,
});
