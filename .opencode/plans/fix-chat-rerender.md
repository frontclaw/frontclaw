# Plan: Fix Chat Workspace Re-rendering

The user is experiencing a performance issue where the entire `ChatWorkspace` component (and thus the message list) re-renders when typing in the input box.

## Problem Analysis

- `ChatWorkspace` (`apps/frontui/components/chat-workspace/index.tsx`) holds the state for the input value (`composerValue`).
- Every keystroke updates this state, causing `ChatWorkspace` to re-render.
- Since `ChatWorkspace` renders the list of messages, the entire list is re-evaluated/re-rendered on every keystroke.
- While `ChatMessage` is memoized, inline function props passed to it break the memoization.

## Solution

Isolate the input state to the `ChatComposer` component so that typing only triggers re-renders within that component.

## Steps

1.  **Refactor `ChatComposer`** (`apps/frontui/components/chat-workspace/chat-composer.tsx`)
    - Remove `value` and `onChange` props.
    - Add internal state: `const [value, setValue] = useState("");`.
    - Update `TextareaAutosize` to use internal state.
    - Update `onSend` prop to accept the message string: `onSend: (message: string) => void`.
    - Implement internal `handleSend` to call `onSend(value)` and clear internal state.

2.  **Update `ChatWorkspace`** (`apps/frontui/components/chat-workspace/index.tsx`)
    - Remove `composerValue` state and `setComposerValue`.
    - Update `ChatComposer` usage:
      - Remove `value` and `onChange` props.
      - Update `onSend` handler to receive the message string directly.
      - Remove the manual clearing of state (since child handles it).

## Verification

- Verify that typing in the input box does not cause the message list to re-render (can be checked via React DevTools or console logs if added).
- Verify that sending a message still works correctly.
- Verify that the input clears after sending.
