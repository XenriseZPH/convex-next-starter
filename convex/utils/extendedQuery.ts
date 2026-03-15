/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Inflectors } from "en-inflectors";
import type {
  DocumentByInfo,
  GenericDataModel,
  GenericDatabaseReader,
  GenericTableInfo,
} from "convex/server";

import type { DatabaseReader } from "../_generated/server";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import schema from "../schema";

// ─── Type utilities (mirrored from extendedStream.ts) ────────────────────────

type Pluralize<S extends string> = S extends `${infer Stem}y`
  ? `${Stem}ies`
  : S extends `${string}ss`
    ? `${S}es`
    : `${S}s`;

type Singularize<S extends string> = S extends `${infer Stem}ies`
  ? `${Stem}y`
  : S extends `${infer Stem}ses`
    ? `${Stem}s`
    : S extends `${infer Stem}s`
      ? Stem
      : S;

type ComposeChildTableName<
  SourceTable extends string,
  RelationName extends string,
> = `${Singularize<SourceTable>}${Capitalize<Pluralize<RelationName>>}`;

type ChildRelationPluralFromSource<SourceTable extends string> = {
  [T in TableNames]: T extends `${Singularize<SourceTable>}${infer Suffix}`
    ? Uncapitalize<Suffix>
    : never;
}[TableNames];

type GlobalRelationName = TableNames | Singularize<TableNames>;

type ReverseRelationTables<SourceTable extends TableNames> = {
  [T in TableNames]: `${Singularize<SourceTable>}Id` extends keyof Doc<T>
    ? T
    : never;
}[TableNames];

type ForwardRelationTables<SourceTable extends TableNames> = {
  [K in Extract<keyof Doc<SourceTable>, string>]: K extends `${infer Prefix}Id`
    ? Pluralize<Prefix> extends TableNames
      ? Pluralize<Prefix>
      : never
    : never;
}[Extract<keyof Doc<SourceTable>, string>];

type ReverseRelationNames<SourceTable extends TableNames> = {
  [T in ReverseRelationTables<SourceTable>]:
    | T
    | Singularize<T>
    | (T extends `${Singularize<SourceTable>}${infer Suffix}`
        ? Uncapitalize<Suffix> | Singularize<Uncapitalize<Suffix>>
        : never);
}[ReverseRelationTables<SourceTable>];

type ForwardRelationNames<SourceTable extends TableNames> = {
  [T in ForwardRelationTables<SourceTable>]: T | Singularize<T>;
}[ForwardRelationTables<SourceTable>];

type RelationNameFromSourceStrict<SourceTable extends TableNames> =
  | ForwardRelationNames<SourceTable>
  | ReverseRelationNames<SourceTable>;

type SourceTableFromItem<T> = {
  [S in TableNames]: T extends Doc<S> ? S : never;
}[TableNames];

type RelationNameFromSource<SourceTable extends TableNames> =
  | RelationNameFromSourceStrict<SourceTable>
  | ChildRelationPluralFromSource<SourceTable>
  | Singularize<ChildRelationPluralFromSource<SourceTable>>;

type ResolveRelationTableFrom<
  SourceTable extends string,
  RelationName extends string,
> = RelationName extends TableNames
  ? RelationName
  : Pluralize<RelationName> extends TableNames
    ? Pluralize<RelationName>
    : ComposeChildTableName<SourceTable, RelationName> extends TableNames
      ? ComposeChildTableName<SourceTable, RelationName>
      : never;

type IsManyRelation<
  RelationName extends string,
  ResolvedTable extends TableNames,
> = RelationName extends ResolvedTable
  ? true
  : RelationName extends `${string}ss`
    ? false
    : RelationName extends `${string}s`
      ? true
      : false;

type RelationValueFrom<
  SourceTable extends string,
  RelationName extends string,
> =
  ResolveRelationTableFrom<SourceTable, RelationName> extends infer T extends
    TableNames
    ? IsManyRelation<RelationName, T> extends true
      ? Array<Doc<T>>
      : Doc<T> | null
    : unknown;

type MergeNestedRelationValue<Relation, Nested> =
  Relation extends Array<infer Item>
    ? Array<Item & Nested>
    : NonNullable<Relation> extends object
      ? (NonNullable<Relation> & Nested) | Extract<Relation, null>
      : Relation;

type ExtractPreloadShape<T> =
  T extends PreloadQueryBuilder<TableNames, infer Shape> ? Shape : {};

type PreloadQueryBuilder<
  SourceTable extends TableNames,
  Shape extends Record<string, unknown> = {},
> = {
  preload<RelationName extends RelationNameFromSource<SourceTable>>(
    relationName: RelationName,
  ): PreloadQueryBuilder<
    SourceTable,
    Shape & Record<RelationName, RelationValueFrom<SourceTable, RelationName>>
  >;

  preload<
    RelationName extends RelationNameFromSource<SourceTable>,
    Callback extends (
      q: PreloadQueryBuilder<
        ResolveRelationTableFrom<SourceTable, RelationName>
      >,
    ) => unknown,
  >(
    relationName: RelationName,
    callback: Callback,
  ): PreloadQueryBuilder<
    SourceTable,
    Shape &
      Record<
        RelationName,
        MergeNestedRelationValue<
          RelationValueFrom<SourceTable, RelationName>,
          ExtractPreloadShape<ReturnType<Callback>>
        >
      >
  >;
};

type PreloadCallback<SourceTable extends TableNames = TableNames> = (
  q: PreloadQueryBuilder<SourceTable>,
) => unknown;

// ─── TableInfo helpers ────────────────────────────────────────────────────────

/**
 * Extends a `GenericTableInfo`'s document type with `Extra`.
 * Used to thread preloaded relation types through the query chain.
 */
type ExtendDoc<TI extends GenericTableInfo, Extra> = {
  document: TI["document"] & Extra;
  fieldPaths: TI["fieldPaths"];
  indexes: TI["indexes"];
  searchIndexes: TI["searchIndexes"];
  vectorIndexes: TI["vectorIndexes"];
};

type SourceTableFromInfo<TI extends GenericTableInfo> = SourceTableFromItem<
  DocumentByInfo<TI>
>;

type RelationNameForInfo<TI extends GenericTableInfo> = [
  SourceTableFromInfo<TI>,
] extends [never]
  ? GlobalRelationName
  : RelationNameFromSource<SourceTableFromInfo<TI>>;

// ─── Module augmentation ──────────────────────────────────────────────────────

declare module "convex/server" {
  interface OrderedQuery<TableInfo extends GenericTableInfo> {
    /**
     * Conditionally applies a transformation to the query.
     * If `condition` is truthy, `callback` is called with this query and its
     * result is returned. If falsy, the query is returned unchanged.
     *
     * Must be used via `extendedQuery(db).query(tableName)` to work at runtime.
     *
     * @example
     * const results = await extendedQuery(ctx.db)
     *   .query("transactions")
     *   .if(args.search, (q) =>
     *     q.withSearchIndex("by_referenceNumber_merchantId_status", (q) =>
     *       q.search("referenceNumber", args.search!)
     *         .eq("merchantId", merchant._id)
     *     )
     *   )
     *   .if(!args.search, (q) =>
     *     q.withIndex("by_merchant_and_status", (q) =>
     *       q.eq("merchantId", merchant._id)
     *     )
     *   )
     *   .paginate(args.paginationOpts);
     */
    if(
      condition: unknown,
      callback: (q: this) => OrderedQuery<TableInfo>,
    ): this;

    /**
     * Filters results using an arbitrary JavaScript/TypeScript predicate,
     * applied after preloads are resolved. Behaves like `convex-helpers filter`
     * but as a chainable method.
     *
     * Must be used via `extendedQuery(db).query(tableName)` to work at runtime.
     *
     * @example
     * const results = await extendedQuery(ctx.db)
     *   .query("transactions")
     *   .withIndex("by_merchantId_status", (q) => q.eq("merchantId", merchant._id))
     *   .preload("merchantProject")
     *   .xfilter((tx) => tx.merchantProject?.type === args.projectType)
     *   .paginate(args.paginationOpts);
     */
    xfilter(
      predicate: (doc: DocumentByInfo<TableInfo>) => Promise<boolean> | boolean,
    ): this;

    /**
     * Eagerly loads a related document (or documents) onto each result.
     *
     * - **Forward relation** (`doc.targetId → target`): the source doc has a
     *   `${targetTable}Id` field. The related doc is attached as a single
     *   value or `null`.
     * - **Reverse relation** (`target.sourceId → source`): the target table
     *   has a `${sourceTable}Id` field. All matching docs are attached as an
     *   array.
     *
     * Must be used via `extendedQuery(db).query(tableName)` to work
     * at runtime.
     *
     * @example
     * const results = await extendedQuery(ctx.db)
     *   .query("transactions")
     *   .preload("merchant")       // forward: transaction.merchantId → merchantDoc
     *   .preload("checkouts")      // reverse: checkout.transactionId → checkoutDoc[]
     *   .preload("merchant", (q) =>
     *     q.preload("store")       // nested: merchant.storeId → storeDoc
     *   )
     *   .paginate(args.paginationOpts);
     */
    preload<RelationName extends RelationNameForInfo<TableInfo>>(
      relationName: RelationName,
    ): OrderedQuery<
      ExtendDoc<
        TableInfo,
        Record<
          RelationName,
          RelationValueFrom<SourceTableFromInfo<TableInfo>, RelationName>
        >
      >
    >;

    preload<
      RelationName extends RelationNameForInfo<TableInfo>,
      Callback extends (
        q: PreloadQueryBuilder<
          ResolveRelationTableFrom<SourceTableFromInfo<TableInfo>, RelationName>
        >,
      ) => unknown,
    >(
      relationName: RelationName,
      callback: Callback,
    ): OrderedQuery<
      ExtendDoc<
        TableInfo,
        Record<
          RelationName,
          MergeNestedRelationValue<
            RelationValueFrom<SourceTableFromInfo<TableInfo>, RelationName>,
            ExtractPreloadShape<ReturnType<Callback>>
          >
        >
      >
    >;
  }
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

type PreloadSpec = {
  relationName: string;
  nested: PreloadSpec[];
};

type QueryWrapperState = {
  db: GenericDatabaseReader<GenericDataModel>;
  schema: unknown;
  table: string;
  preloads: PreloadSpec[];
  xfilters: Array<(doc: unknown) => Promise<boolean> | boolean>;
};

const IS_WRAPPED = Symbol.for("extendedQuery.isWrapped");
const WRAPPER_STATE = Symbol.for("extendedQuery.wrapperState");

const TERMINAL_METHODS = new Set([
  "collect",
  "paginate",
  "first",
  "unique",
  "take",
]);

function isQueryLike(value: unknown): value is object {
  if (!value || typeof value !== "object" || value instanceof Promise) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.filter === "function" ||
    typeof v.paginate === "function" ||
    typeof v.withIndex === "function" ||
    typeof v.withSearchIndex === "function"
  );
}

function createPreloadBuilder(
  target: PreloadSpec[],
): PreloadQueryBuilder<TableNames> {
  return {
    preload(relationName: string, callback?: PreloadCallback) {
      const nested: PreloadSpec[] = [];
      if (callback) {
        callback(createPreloadBuilder(nested));
      }
      target.push({ relationName, nested });
      return this;
    },
  };
}

function wrapQuery<Q extends object>(query: Q, state: QueryWrapperState): Q {
  const proxy: Q = new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === IS_WRAPPED) return true;
      if (prop === WRAPPER_STATE) return state;

      if (prop === "if") {
        return function (condition: unknown, callback: (q: Q) => Q): Q {
          return condition ? callback(proxy) : proxy;
        };
      }

      if (prop === "preload") {
        return function (relationName: string, callback?: PreloadCallback): Q {
          const nested: PreloadSpec[] = [];
          if (callback) {
            callback(createPreloadBuilder(nested));
          }
          const newState: QueryWrapperState = {
            ...state,
            preloads: [...state.preloads, { relationName, nested }],
          };
          return wrapQuery(target, newState);
        };
      }

      if (prop === "xfilter") {
        return function (
          predicate: (doc: unknown) => Promise<boolean> | boolean,
        ): Q {
          const newState: QueryWrapperState = {
            ...state,
            xfilters: [...state.xfilters, predicate],
          };
          return wrapQuery(target, newState);
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      return function (this: unknown, ...args: unknown[]) {
        const result = (value as (...a: unknown[]) => unknown).apply(
          target,
          args,
        );

        if (
          result instanceof Promise &&
          (state.preloads.length > 0 || state.xfilters.length > 0) &&
          typeof prop === "string" &&
          TERMINAL_METHODS.has(prop)
        ) {
          return result.then((data) =>
            applyPreloadsToTerminalResult(prop, data, state),
          );
        }

        if (isQueryLike(result)) {
          return wrapQuery(result, state);
        }

        return result;
      };
    },
  });

  return proxy;
}

// ─── Terminal result handlers ─────────────────────────────────────────────────

async function asyncFilter<T>(
  arr: T[],
  predicate: (d: T) => Promise<boolean> | boolean,
): Promise<T[]> {
  const results = await Promise.all(arr.map(predicate));
  return arr.filter((_v, index) => results[index]);
}

async function applyXfilters(
  doc: unknown,
  xfilters: QueryWrapperState["xfilters"],
): Promise<boolean> {
  for (const predicate of xfilters) {
    if (!(await predicate(doc))) return false;
  }
  return true;
}

async function applyPreloadsToTerminalResult(
  method: string,
  data: unknown,
  state: QueryWrapperState,
): Promise<unknown> {
  if (method === "paginate") {
    const result = data as {
      page: unknown[];
      isDone: boolean;
      continueCursor: string;
    };
    const page = await applyPreloadsToArray(result.page, state);
    const filteredPage =
      state.xfilters.length > 0
        ? await asyncFilter(page, (doc) => applyXfilters(doc, state.xfilters))
        : page;
    return { ...result, page: filteredPage };
  }

  if (method === "collect" || method === "take") {
    const docs = await applyPreloadsToArray(data as unknown[], state);
    return state.xfilters.length > 0
      ? asyncFilter(docs, (doc) => applyXfilters(doc, state.xfilters))
      : docs;
  }

  // first / unique
  const doc = await applyPreloadToDoc(data, state);
  if (state.xfilters.length > 0 && doc != null) {
    return (await applyXfilters(doc, state.xfilters)) ? doc : null;
  }
  return doc;
}

async function applyPreloadsToArray(
  docs: unknown[],
  state: QueryWrapperState,
): Promise<unknown[]> {
  return Promise.all(docs.map((doc) => applyPreloadToDoc(doc, state)));
}

async function applyPreloadToDoc(
  doc: unknown,
  state: QueryWrapperState,
): Promise<unknown> {
  if (!doc || typeof doc !== "object") return doc;
  let result = doc as Record<string, unknown>;
  for (const spec of state.preloads) {
    result = await preloadIntoSingleDocument(
      state.db,
      state.schema,
      state.table,
      result,
      spec,
    );
  }
  return result;
}

// ─── Preload helpers (mirrored from extendedStream.ts) ────────────────────────

type SchemaLike = {
  tables?: Record<
    string,
    {
      indexes?: Array<{
        fields?: unknown[];
        indexDescriptor?: unknown;
      }>;
    }
  >;
};

type DynamicIndexedQuery = {
  collect: () => Promise<unknown[]>;
  unique: () => Promise<unknown | null>;
};

type DynamicDb = {
  get: (tableName: string, id: unknown) => Promise<unknown | null>;
  query: (tableName: string) => {
    withIndex: (
      indexName: string,
      rangeBuilder: (q: {
        eq: (field: string, value: unknown) => unknown;
      }) => unknown,
    ) => DynamicIndexedQuery;
  };
};

function asSchemaLike(schema: unknown): SchemaLike | null {
  if (!schema || typeof schema !== "object") return null;
  return schema as SchemaLike;
}

function getByTableAndId(
  db: GenericDatabaseReader<GenericDataModel>,
  tableName: string,
  id: unknown,
) {
  return (db as unknown as DynamicDb).get(tableName, id);
}

function queryByDynamicIndex(
  db: GenericDatabaseReader<GenericDataModel>,
  tableName: string,
  indexName: string,
  fieldName: string,
  value: unknown,
): DynamicIndexedQuery {
  return (db as unknown as DynamicDb)
    .query(tableName)
    .withIndex(indexName, (q) => q.eq(fieldName, value));
}

function toForeignKeyField(tableName: string): string {
  if (tableName.endsWith("ies")) {
    return `${tableName.slice(0, -3)}yId`;
  }
  if (tableName.endsWith("s")) {
    return `${tableName.slice(0, -1)}Id`;
  }
  return `${tableName}Id`;
}

function inflectLastWord(value: string, fn: (word: string) => string): string {
  const idx = value.search(/[A-Z][^A-Z]*$/);
  if (idx > 0) {
    const prefix = value.slice(0, idx);
    const lastWord = value.slice(idx);
    const inflected = fn(lastWord.toLowerCase());
    return prefix + capitalize(inflected);
  }
  return fn(value);
}

function pluralize(value: string): string {
  return inflectLastWord(value, (w) => new Inflectors(w).toPlural());
}

function singularize(value: string): string {
  return inflectLastWord(value, (w) => new Inflectors(w).toSingular());
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function isPluralRelationName(
  relationName: string,
  targetTable: string,
): boolean {
  if (relationName === targetTable) return true;
  return pluralize(singularize(relationName)) === relationName;
}

function findIndexByFirstField(
  schema: unknown,
  tableName: string,
  firstField: string,
): string | null {
  const schemaLike = asSchemaLike(schema);
  const indexes = schemaLike?.tables?.[tableName]?.indexes;
  if (!Array.isArray(indexes)) return null;
  const match = indexes.find(
    (index) => Array.isArray(index.fields) && index.fields[0] === firstField,
  );
  if (!match?.indexDescriptor) return null;
  return String(match.indexDescriptor);
}

function resolveTargetTableName(
  schema: unknown,
  relationName: string,
  sourceTable?: string,
): string {
  const schemaLike = asSchemaLike(schema);
  if (schemaLike?.tables?.[relationName]) return relationName;
  const plural = pluralize(relationName);
  if (schemaLike?.tables?.[plural]) return plural;
  if (sourceTable) {
    const composed = `${singularize(sourceTable)}${capitalize(plural)}`;
    if (schemaLike?.tables?.[composed]) return composed;
  }
  throw new Error(`preload() unknown relation/table: ${relationName}`);
}

async function applyNestedPreloads(
  db: GenericDatabaseReader<GenericDataModel>,
  schema: unknown,
  sourceTable: string,
  relation: unknown,
  specs: PreloadSpec[],
): Promise<unknown> {
  if (specs.length === 0 || relation === null || relation === undefined) {
    return relation;
  }

  if (Array.isArray(relation)) {
    return Promise.all(
      relation.map((item) =>
        preloadNestedIntoDoc(db, schema, sourceTable, item, specs),
      ),
    );
  }

  return preloadNestedIntoDoc(db, schema, sourceTable, relation, specs);
}

async function preloadNestedIntoDoc(
  db: GenericDatabaseReader<GenericDataModel>,
  schema: unknown,
  sourceTable: string,
  relationDoc: unknown,
  specs: PreloadSpec[],
): Promise<unknown> {
  if (!relationDoc || typeof relationDoc !== "object") return relationDoc;
  let current = relationDoc as Record<string, unknown>;
  for (const spec of specs) {
    current = await preloadIntoSingleDocument(
      db,
      schema,
      sourceTable,
      current,
      spec,
    );
  }
  return current;
}

async function preloadIntoSingleDocument(
  db: GenericDatabaseReader<GenericDataModel>,
  schema: unknown,
  sourceTable: string,
  sourceDoc: Record<string, unknown>,
  spec: PreloadSpec,
): Promise<Record<string, unknown>> {
  const targetTable = resolveTargetTableName(
    schema,
    spec.relationName,
    sourceTable,
  );
  const sourceToTargetField = toForeignKeyField(targetTable);
  const targetToSourceField = toForeignKeyField(sourceTable);
  const reverseIndex = findIndexByFirstField(
    schema,
    targetTable,
    targetToSourceField,
  );
  const preloadMany = isPluralRelationName(spec.relationName, targetTable);

  let relation: unknown;
  if (Object.prototype.hasOwnProperty.call(sourceDoc, sourceToTargetField)) {
    const relationId = sourceDoc[sourceToTargetField] as
      | Id<TableNames>
      | undefined;
    relation = relationId
      ? await getByTableAndId(db, targetTable, relationId)
      : null;
  } else {
    if (!reverseIndex) {
      throw new Error(
        `preload() could not detect relationship from ${sourceTable} to ${targetTable}`,
      );
    }

    const sourceId = sourceDoc._id;
    if (!sourceId) {
      relation = null;
    } else {
      const relationQuery = queryByDynamicIndex(
        db,
        targetTable,
        reverseIndex,
        targetToSourceField,
        sourceId,
      );
      relation = preloadMany
        ? await relationQuery.collect()
        : await relationQuery.unique();
    }
  }

  const relationWithNested = await applyNestedPreloads(
    db,
    schema,
    targetTable,
    relation,
    spec.nested,
  );

  return { ...sourceDoc, [spec.relationName]: relationWithNested };
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Wraps `db` to add chainable `.if()` and `.preload()` methods to the query
 * builder. Pass `schema` to enable relation-name resolution for `.preload()`.
 *
 * @example
 * const results = await extendedQuery(ctx.db)
 *   .query("transactions")
 *   .if(args.search, (q) =>
 *     q.withSearchIndex("by_referenceNumber_merchantId_status", (q) =>
 *       q.search("referenceNumber", args.search!)
 *         .eq("merchantId", merchant._id)
 *         .eq("status", ETransactionStatus.SUCCESS)
 *     )
 *   )
 *   .if(!args.search, (q) =>
 *     q.withIndex("by_merchant_and_status", (q) =>
 *       q.eq("merchantId", merchant._id)
 *         .eq("status", ETransactionStatus.SUCCESS)
 *     )
 *   )
 *   .preload("merchant")
 *   .if(args.dateFrom, (q) =>
 *     q.filter((q) => q.gt(q.field("createdAt"), args.dateFrom!))
 *   )
 *   .paginate(args.paginationOpts);
 */
export function extendedQuery(db: DatabaseReader) {
  return {
    query<T extends TableNames>(tableName: T) {
      const state: QueryWrapperState = {
        db: db as unknown as GenericDatabaseReader<GenericDataModel>,
        schema,
        table: tableName,
        preloads: [],
        xfilters: [],
      };
      return wrapQuery(db.query(tableName), state);
    },
  };
}
