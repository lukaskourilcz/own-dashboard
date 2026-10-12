Code panel in the website's One Dark palette (Prism one-dark), JetBrains Mono 28 px, with a tinted tests row below.

```jsx
<Panel style={{ padding: '32px 20px', justifyContent: 'center' }}>
  <CodeBlock lines={[
    [['const', 'k'], ' ', ['topKFrequent', 'f'], ' ', ['=', 'o'], ' (nums, k) ', ['=>', 'o'], ' {'],
    ['  ', ['return', 'k'], ' nums;'],
    ['};'],
  ]} />
  <TestsPassed>25 of 25 tests passed</TestsPassed>
</Panel>
```

- Keep lines under ~46 characters so nothing wraps; 8–9 lines fit under a two-line headline.
- No comment lines in marketing code.
