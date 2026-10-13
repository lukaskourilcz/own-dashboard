// The two devShark carousels, composed from the carousel primitives. Edit copy here; geometry lives in the components and tokens.
const NS = Object.values(window).find(v => v && typeof v === 'object' && v.Slide && v.Kicker) || {};
const { Slide, Kicker, Headline, Statement, Accent, Footer, BigNumber, Panel, PanelRow, Body, TintRow, TechChip, ChipRow, CodeBlock, TestsPassed, Logo } = NS;
const A = '../../assets/';
const CODE = [
  [['const','k'],' ',['topKFrequent','f'],' ',['=','o'],' (nums, k) ',['=>','o'],' {'],
  ['  ',['const','k'],' counts ',['=','o'],' ',['new','k'],' ',['Map','c'],'();'],
  ['  ',['for','k'],' (',['const','k'],' n ',['of','k'],' nums) {'],
  ['    counts.',['set','f'],'(n, (counts.',['get','f'],'(n) ',['??','o'],' ',['0','n'],') ',['+','o'],' ',['1','n'],');'],
  ['  }'],
  ['  ',['return','k'],' [',['...','o'],'counts]'],
  ['    .',['sort','f'],'((a, b) ',['=>','o'],' b[',['1','n'],'] ',['-','o'],' a[',['1','n'],'])'],
  ['    .',['slice','f'],'(',['0','n'],', k).',['map','f'],'(([n]) ',['=>','o'],' n);'],
  ['};'],
];
const FREE = ['HTML, CSS and JavaScript in full', 'React, levels 1 to 12', 'Every quiz and the daily challenge', 'A starter set of coding challenges', 'No ads'];

const Cover = ({ wave }) => (
  <Slide theme="dark" bigFin="big" label="1 · cover">
    <Kicker wave={wave}>Introducing</Kicker>
    <Headline size="cover">Meet devShark.</Headline>
    <Statement>A <Accent>learning platform</Accent> for web developers: lessons, <Accent>interview preparations</Accent>, quizzes, and graded coding tasks.</Statement>
    <Footer align="right" ink>Swipe →</Footer>
  </Slide>
);
const How = ({ wave }) => (
  <Slide theme="light" bigFin="small" label="2 · how it works">
    <Kicker wave={wave}>How it works</Kicker>
    <Headline>Learn. Quiz. Code.</Headline>
    <Panel rows fill={false} style={{ padding: '28px 20px' }}>
      <PanelRow marker="01">Guided lessons build the concept.</PanelRow>
      <PanelRow marker="02">Quizzes check it.</PanelRow>
      <PanelRow marker="03" highlighted>Coding tasks prove it, graded on the server.</PanelRow>
      <PanelRow marker="04">Curate your tech interview preparation.</PanelRow>
    </Panel>
  </Slide>
);
const Topics = ({ wave }) => (
  <Slide theme="light" label="3 · topics">
    <Kicker wave={wave}>Topics</Kicker>
    <Headline>16 topics, <br />one path.</Headline>
    <Panel style={{ padding: '40px 48px' }}>
      <ChipRow>{['html5','css3','javascript','typescript','react','nextjs','nodejs'].map(t => <TechChip key={t} tech={t} assetBase={A} />)}</ChipRow>
      <Body muted size="var(--type-body-sm)" style={{ marginTop: 'auto', paddingTop: 'var(--gap-topics-note)' }}>…and also <strong style={{ fontWeight: 500, color: 'var(--panel-text)' }}>Databases, Git, Data Structure Algorithms, System Design, Algorithms, DevOps and Security.</strong></Body>
    </Panel>
  </Slide>
);
const Code = ({ wave }) => (
  <Slide theme="dark" label="4 · coding challenges">
    <Kicker wave={wave}>Coding challenges</Kicker>
    <Headline>770 challenges. Easy to Hard.</Headline>
    <Body size="var(--type-body-sm)" style={{ marginTop: 28 }}>Write real code in the browser. Tests run on the server and tell you exactly what failed.</Body>
    <Panel style={{ marginTop: 40, padding: '32px 20px', justifyContent: 'center' }}>
      <CodeBlock lines={CODE} />
      <TestsPassed>25 of 25 tests passed</TestsPassed>
    </Panel>
  </Slide>
);
const Daily = ({ wave }) => (
  <Slide theme="green" bigFin="huge" label="5 · every day">
    <Kicker wave={wave}>Every day</Kicker>
    <Headline size="hero" style={{ marginTop: 48 }}>One question a day. A streak worth keeping.</Headline>
    <Body size="var(--type-body-sm)" style={{ marginTop: 'auto', maxWidth: 640 }}>Daily challenge, streaks, friends and a 30-day leaderboard. Boards rank by correct answers, never by streak.</Body>
  </Slide>
);
const Free = ({ wave, theme = 'light', kicker = 'Free, for every account' }) => (
  <Slide theme={theme} label="free">
    <Kicker wave={wave}>{kicker}</Kicker>
    <Headline>Start with the foundations.</Headline>
    <Panel rows>{FREE.map((t, i) => <PanelRow key={t} highlighted={i === 0}>{t}</PanelRow>)}</Panel>
  </Slide>
);
const Price = ({ wave, theme = 'dark' }) => (
  <Slide theme={theme} label="price">
    <Kicker wave={wave}>Premium · launch price</Kicker>
    <BigNumber value="€1.80" unit="a month" />
    <Panel style={{ padding: '48px 20px 20px' }}>
      <Body strong muted style={{ padding: '0 28px', lineHeight: 1.3 }}>or €18 a year, VAT included</Body>
      <Body size="42px" style={{ margin: '32px 0 0', padding: '0 28px' }}>Everything in devShark. 55% below the regular price of €3.99 a month, which applies from 3 November 2026. Kept for the lifetime of your subscription. Cancel anytime.</Body>
      <TintRow>Offer ends 2 Nov 2026</TintRow>
    </Panel>
  </Slide>
);
const Close = ({ wave, theme = 'green', headline }) => (
  <Slide theme={theme} bigFin="tucked" label="close">
    <Logo />
    <Headline size="hero" style={{ marginTop: 88 }}>{headline}</Headline>
    <Panel fill={false} style={{ marginTop: 'auto', alignSelf: 'flex-start', position: 'relative', padding: '32px 48px' }}>
      <Body strong size="var(--type-url)" style={{ lineHeight: 1.1, letterSpacing: '-0.01em' }}>devshark.app</Body>
    </Panel>
  </Slide>
);

// Premium launch offer
const Discount = ({ wave }) => (
  <Slide theme="dark" bigFin="big" label="1 · discount">
    <Kicker wave={wave}>Premium · launch price</Kicker>
    <BigNumber value="55%" unit="off" />
    <Headline as="h2" size="cover" style={{ marginTop: 24, fontSize: 72, lineHeight: 1.05 }}>below the regular price.</Headline>
    <Statement style={{ fontSize: 72 }}>An introductory price on <Accent>devShark Premium</Accent>, kept for the lifetime of your subscription.</Statement>
    <Footer align="right" ink>Swipe →</Footer>
  </Slide>
);
const PriceShort = ({ wave }) => (
  <Slide theme="light" bigFin="small" label="2 · price">
    <Kicker wave={wave}>The price</Kicker>
    <BigNumber value="€1.80" unit="a month" />
    <Panel fill={false} style={{ padding: '40px 20px 20px', gap: 28 }}>
      <Body strong muted style={{ padding: '0 28px', lineHeight: 1.3 }}>or €18 a year, VAT included</Body>
      <Body size="42px" style={{ padding: '0 28px' }}>The regular price of €3.99 a month applies from 3 November 2026. Cancel anytime.</Body>
      <TintRow>Offer ends 2 Nov 2026</TintRow>
    </Panel>
  </Slide>
);
const Opens = ({ wave }) => (
  <Slide theme="green" label="3 · what premium opens">
    <Kicker wave={wave}>What Premium opens</Kicker>
    <Headline>Every topic. Every task.</Headline>
    <Panel rows>{['Every Learn topic, in full', 'All 770 coding tasks', 'Coins redeemable for merchandise', 'Same grading, XP and rankings as everyone', 'Cancel anytime'].map((t, i) => <PanelRow key={t} highlighted={i === 0}>{t}</PanelRow>)}</Panel>
  </Slide>
);

const WAVES = [1, 4, 7, 2, 5, 8, 3, 6];
export function FullCarousel() {
  return [<Cover wave={WAVES[0]} />, <How wave={WAVES[1]} />, <Topics wave={WAVES[2]} />, <Code wave={WAVES[3]} />, <Daily wave={WAVES[4]} />, <Free wave={WAVES[5]} />, <Price wave={WAVES[6]} />, <Close wave={WAVES[7]} headline={<>Try one question.<br /><span style={{ color: 'var(--brand-ink)' }}>No signup needed.</span></>} />];
}
export function PremiumCarousel() {
  return [<Discount wave={WAVES[0]} />, <PriceShort wave={WAVES[1]} />, <Opens wave={WAVES[2]} />, <Close wave={WAVES[3]} theme="dark" headline="Lock in the launch price." />];
}
window.DevSharkCarousels = { FullCarousel, PremiumCarousel };
