Panel is the one surface card per slide; PanelRow, Body and TintRow are what goes inside.

```jsx
<Panel rows>
  <PanelRow marker="01">Guided lessons build the concept.</PanelRow>
  <PanelRow marker="03" highlighted>Coding tasks prove it, graded on the server.</PanelRow>
</Panel>
<Panel fill={false}><Body size="var(--type-body-lg)">Daily challenge, streaks…</Body></Panel>
```

- Never more than one panel per slide, and never on the cover.
- One `highlighted` row per slide at most.
