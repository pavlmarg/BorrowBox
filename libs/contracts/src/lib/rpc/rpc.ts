/** Every gateway → service message (NestJS TCP, ADR-0005) is wrapped like this. */
export interface RpcRequest<TData> {
  /** From the incoming HTTP request; becomes the `correlationId` of any event emitted. */
  correlationId: string;
  /** The caller's JWT, re-verified by the service (defence in depth). Absent for anonymous calls. */
  accessToken?: string;
  data: TData;
}

/** Error body carried by an `RpcException`; the gateway maps `code` to an HTTP status. */
export interface RpcErrorBody<TCode extends string = string> {
  code: TCode;
  message: string;
}
