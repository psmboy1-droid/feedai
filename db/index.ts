import * as schema from './schema';

export interface MockStatement {
    bind(...args: any[]): MockStatement;
    first<T = any>(): Promise<T | null>;
    all<T = any>(): Promise<{ results: T[] }>;
    run(): Promise<{ success: boolean }>;
}

export interface MockClient {
    prepare(query: string): MockStatement;
    batch(statements: any[]): Promise<any[]>;
}

export interface DbInstance {
    $client: MockClient;
    select(...args: any[]): any;
    insert(...args: any[]): any;
    update(...args: any[]): any;
    delete(...args: any[]): any;
    run(...args: any[]): Promise<any>;
    get(...args: any[]): Promise<any>;
    all(...args: any[]): Promise<any[]>;
}

const safeMockStatement: MockStatement = {
    bind: () => safeMockStatement,
    first: async <T = any>() => null as T | null,
    all: async <T = any>() => ({ results: [] as T[] }),
    run: async () => ({ success: true }),
};

const safeMockClient: MockClient = {
    prepare: () => safeMockStatement,
    batch: async () => [],
};

const safeMockDb: DbInstance = {
    $client: safeMockClient,
    select: () => ({
        from: () => ({
            where: () => [],
            orderBy: () => [],
            all: async () => [],
        }),
    }),
    insert: () => ({
        values: () => ({
            onConflictDoNothing: () => ({ returning: async () => [] }),
            onConflictDoUpdate: () => ({ returning: async () => [] }),
            returning: async () => [],
        }),
    }),
    update: () => ({
        set: () => ({
            where: () => ({
                returning: async () => [],
            }),
        }),
    }),
    delete: () => ({
        where: () => ({
            returning: async () => [],
        }),
    }),
    run: async () => ({ success: true }),
    get: async () => null,
    all: async () => [],
};

export function getDb(): DbInstance {
    return safeMockDb;
}
