export type IsString<T> = T extends string ? true : false;

export type Unwrap<T> = T extends Promise<infer U> ? U : T;
