/**
 * RPC Protocol Types
 * These types define the communication protocol between Core and Plugin Workers
 */

/** Unique identifier for RPC requests */
export type RPCRequestId = string;

/** Types of messages that can be sent across the bridge */
export type RPCMessageType = "HOOK" | "SYS_CALL" | "RESPONSE" | "ERROR";

/** Base RPC envelope for all messages */
export interface RPCEnvelope {
  id: RPCRequestId;
  type: RPCMessageType;
  timestamp: number;
}

/** Request from Core to Plugin (calling a hook) */
export interface RPCHookRequest extends RPCEnvelope {
  type: "HOOK";
  method: string;
  payload: unknown;
}

/** Request from Plugin to Core (system call) */
export interface RPCSysCallRequest extends RPCEnvelope {
  type: "SYS_CALL";
  method: string;
  payload: unknown;
}

/** Successful response */
export interface RPCSuccessResponse extends RPCEnvelope {
  type: "RESPONSE";
  success: true;
  result: unknown;
}

/** Error response */
export interface RPCErrorResponse extends RPCEnvelope {
  type: "ERROR";
  success: false;
  error: {
    code: string;
    message: string;
    stack?: string;
  };
}

/** Union of all response types */
export type RPCResponse = RPCSuccessResponse | RPCErrorResponse;

/** Union of all request types */
export type RPCRequest = RPCHookRequest | RPCSysCallRequest;

/** Union of all message types */
export type RPCMessage = RPCRequest | RPCResponse;

/** Create a unique request ID */
export function createRequestId(): RPCRequestId {
  return crypto.randomUUID();
}

/** Create a hook request */
export function createHookRequest(
  method: string,
  payload: unknown,
): RPCHookRequest {
  return {
    id: createRequestId(),
    type: "HOOK",
    method,
    payload,
    timestamp: Date.now(),
  };
}

/** Create a system call request */
export function createSysCallRequest(
  method: string,
  payload: unknown,
): RPCSysCallRequest {
  return {
    id: createRequestId(),
    type: "SYS_CALL",
    method,
    payload,
    timestamp: Date.now(),
  };
}

/** Create a success response */
export function createSuccessResponse(
  requestId: RPCRequestId,
  result: unknown,
): RPCSuccessResponse {
  return {
    id: requestId,
    type: "RESPONSE",
    success: true,
    result,
    timestamp: Date.now(),
  };
}

/** Create an error response */
export function createErrorResponse(
  requestId: RPCRequestId,
  code: string,
  message: string,
  stack?: string,
): RPCErrorResponse {
  return {
    id: requestId,
    type: "ERROR",
    success: false,
    error: { code, message, stack },
    timestamp: Date.now(),
  };
}
