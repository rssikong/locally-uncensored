# Remove refusals: third-party notices

What the refusal-removal tool in the Model Manager uses, and under which terms. None of it is part of the app download: the first run of the tool installs it onto the computer, unchanged, from its publishers, into a folder of LU's own (`<app data>/abliterate`). Versions are the pinned ones (`src-tauri/resources/abliterate/requirements.txt` and `constraints.txt`, the llama.cpp commit in `src-tauri/src/commands/abliterate/mod.rs`).

## Software

| Package | License | Source |
| --- | --- | --- |
| Heretic (heretic-llm) 1.4.0 | AGPL-3.0-or-later | https://github.com/p-e-w/heretic |
| llama.cpp converter (`convert_hf_to_gguf.py`, `conversion/`, `gguf-py/`) at 049326a0 (b9949) | MIT | https://github.com/ggml-org/llama.cpp |
| llama-quantize from the same llama.cpp commit, shipped on macOS as `lu-llama-quantize` | MIT | https://github.com/ggml-org/llama.cpp |
| PyTorch (2.14.1 on macOS, the CUDA or ROCm build of pytorch.org elsewhere) | as its package metadata states: `Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT` | https://pytorch.org |
| Transformers 5.20.2, PEFT 0.21.2, Accelerate 1.15.0, Datasets 4.8.5, huggingface_hub 1.33.0, safetensors 0.8.0, tokenizers 0.23.3 | Apache-2.0 | https://github.com/huggingface |
| Optuna 4.9.0 | MIT | https://github.com/optuna/optuna |
| bitsandbytes 0.50.2 | MIT | https://github.com/bitsandbytes-foundation/bitsandbytes |
| lm-evaluation-harness 0.4.13 | MIT | https://github.com/EleutherAI/lm-evaluation-harness |

The other packages in `constraints.txt` are what these depend on, each under its own license as stated in its package metadata.

Heretic is licensed under the same terms as LU (AGPL-3.0). Where that is written down: the wheel heretic_llm-1.4.0 states `License-Expression: AGPL-3.0-or-later` and the classifier "GNU Affero General Public License v3 or later (AGPLv3+)" in its METADATA (core metadata 2.4; PyPI's older `license` field stays empty for packages that use the expression), and the project's README and pyproject.toml say the same. LU runs it unchanged as a Python package; the script that drives it without its menus is LU's own (`src-tauri/resources/abliterate/lu_abliterate.py`, AGPL-3.0-only like the rest of LU).

## Prompt sets

Fetched by revision at run time. Only counts are kept, never the prompts or the answers.

| Set | Used for | License |
| --- | --- | --- |
| mlabonne/harmless_alpaca @ 02c6a92c | Heretic's search (harmless side) | not stated on the dataset card |
| mlabonne/harmful_behaviors @ 01cead01 | Heretic's search (refused side) | not stated on the dataset card |
| JailbreakBench/JBB-Behaviors @ 886acc35 | the check before and after | MIT |
| cais/mmlu @ c30699e8 | the knowledge part of the check | MIT |

## Models

The tool downloads the original weights of the model it works on from Hugging Face, at the commit the dialog showed. Each model keeps its own license, and the copy LU makes carries the same terms. The dialog names the license before the run and asks the user to confirm any license that is not on LU's open list (Apache-2.0, MIT, BSD, CC BY, CC0, Unlicense).
