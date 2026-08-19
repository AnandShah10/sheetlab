import { HostToWebviewMessage, WebviewToHostMessage } from '../../../src/types/workbook';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

type Handler = (msg: HostToWebviewMessage) => void;
const handlers: Handler[] = [];

export function onHostMessage(handler: Handler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  for (const h of handlers) h(event.data);
});
