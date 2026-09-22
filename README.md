# pi-diy-gate

A Pi extension that runs on each user request, asks the active model whether the request is easy enough to do alone, and sometimes blocks it with a self-learning prompt.

## Install

```bash
pi install pi-diy-gate
```

## Config

Create `~/.pi/agent/pi-diy-gate.json` or, for a trusted project, `.pi/pi-diy-gate.json`:

```json
{
  "enabled": true,
  "judgeDifficulty": true,
  "model": "anthropic/claude-sonnet-4-5",
  "validRejectEvery": 5,
  "validRandomRejectProbability": 0.01,
  "difficultRejectEvery": 10,
  "visibleFeedback": true
}
```

Omit `model` to use Pi's current model. Set `judgeDifficulty` to `false` to count every request as valid for rejection.

Runtime commands:

- `/diy-on` and `/diy-off`
- `/diy-judge-on` and `/diy-judge-off`
- `/diy-model provider/model`, `/diy-model current`, or `/diy-model default`

Counters are stored in `~/.pi/agent/pi-diy-gate-state.json`.
