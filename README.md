# pi-diy-gate

A Pi extension that runs on each user request, asks the active model whether the request is easy enough to do alone, 
and sometimes blocks it with a self-learning prompt.

## Where the idea stems from

This package exists because of the MIT Media Labs observation that LLM use decreases the ownership of content produced
and led to lower rates of remembering the contents of the produced work.[^mit]

[^mit]: [Blog: MIT Media Lab - Your Brain in ChatGPT](https://www.media.mit.edu/publications/your-brain-on-chatgpt/), 
[Paper: arxiv](https://arxiv.org/abs/2506.08872)

To mitigate this this package enforces a scheduled + random + difficulty gated rejection of requests to the agent,
nudging the user to solve the task themselves instead. 
The idea for this is loosely inspired by training and certification procedures in the medical and aviation fields.
There it is not uncommon to have to regularly retake courses to prevent unlearning.

## Install

```bash
pi install https://github.com/hv10/pi-diy-gate.git
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
