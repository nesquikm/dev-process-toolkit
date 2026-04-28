export type UserId = string & { readonly __brand: "UserId" };

export interface User {
  id: UserId;
  name: string;
}
