---
name: devshark-design
description: Use this skill to generate well-branded interfaces and assets for devShark — Instagram/Threads carousels first, but also any devShark-branded mock or prototype. Contains the brand rules, colours, type, marks, the waterline and grain, and the carousel components.
user-invocable: true
---

Read the readme.md file within this skill, and explore the other available files (tokens/, guidelines/, components/carousel/, ui_kits/carousel/, assets/).
If creating visual artifacts (carousels, slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view; compose slides from the carousel primitives and the tokens, and keep the non-negotiables: kit marks only, no corner fin, logo on the last slide only, name spelled devShark, no gradients/shadows/imagery, contrast 4.5:1, one idea per slide.
If working on production code, copy assets and read the rules here to become an expert in designing with this brand; the product's own tokens live in client/src/styles/astryx-theme.css of lukaskourilcz/react-express-app and take precedence in-app.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions (which carousel: introduction, premium offer, a single question from the bank; how many slides; which colour sequence), and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
