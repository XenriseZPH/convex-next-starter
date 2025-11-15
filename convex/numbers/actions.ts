"use node";

import { api } from "@/convex-gen/api";
import { action } from "@/convex-gen/server";
import { v } from "convex/values";

export const myAction = action({
  args: {
    first: v.number(),
    second: v.string(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(api.numbers.queries.listNumbers, {
      count: 10,
    });
    console.log(data);

    await ctx.runMutation(api.numbers.mutations.addNumber, {
      value: args.first,
    });
  },
});
