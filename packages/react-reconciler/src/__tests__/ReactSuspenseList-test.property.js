let React;
let ReactFeatureFlags;
let ReactNoop;
let Scheduler;
let Suspense;
let SuspenseList;
//let fc;
import fc from 'fast-check';

describe('ReactSuspenseList', () => {
  if (!__EXPERIMENTAL__) {
    it("empty test so Jest doesn't complain", () => {});
    return;
  }

  beforeEach(() => {
    jest.resetModules();
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.debugRenderPhaseSideEffectsForStrictMode = false;
    ReactFeatureFlags.replayFailedUnitOfWorkWithInvokeGuardedCallback = false;
    ReactFeatureFlags.enableSuspenseServerRenderer = true;
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    Suspense = React.Suspense;
    SuspenseList = React.SuspenseList;
    //fc = require('fast-check');
  });

  function Text(props) {
    Scheduler.unstable_yieldValue(props.text);
    return <span>{props.text}</span>;
  }

  function createAsyncText(text) {
    let resolved = false;
    let Component = function() {
      if (!resolved) {
        Scheduler.unstable_yieldValue('Suspend! [' + text + ']');
        throw promise;
      }
      return <Text text={text} />;
    };
    let promise = new Promise(resolve => {
      Component.resolve = function() {
        resolved = true;
        return resolve();
      };
    });
    return Component;
  }

  function createScheduledText(s, text, onResolve) {
    let resolved = false;
    let Component = function() {
      if (!resolved) {
        Scheduler.unstable_yieldValue('Suspend! [' + text + ']');
        throw promise;
      }
      return <Text text={text} />;
    };
    let promise = s.schedule(Promise.resolve(text)).then(() => {
      resolved = true;
      if (onResolve) {
        onResolve();
      }
    });
    return Component;
  }

  function flushAndYieldScheduler() {
    Scheduler.unstable_flushAllWithoutAsserting();
    Scheduler.unstable_clearYields();
  }

  it('displays all "together" whatever the components structure', async () => {
    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    const SuspenseArb = fc.hexaString(1, 2).noShrink();
    const SuspenseListArb = fc.memo(n => {
      if (n <= 1) {
        return fc.array(SuspenseArb, 1, 3);
      }
      return fc.array(fc.oneof(SuspenseArb, SuspenseListArb()), 1, 3);
    });

    await fc.assert(
      fc.asyncProperty(
        SuspenseListArb(4),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const flatTreeDefinition = [];
          const myMap = Object.create(null);
          const getOrCreateScheduledText = label => {
            // With that trick a same promise can resolve two components at the same time
            if (myMap[label]) {
              return myMap[label];
            }
            myMap[label] = createScheduledText(s, label);
            return myMap[label];
          };
          const buildComponentsTree = tree => {
            if (typeof tree === 'string') {
              // We are rendering a Suspense
              flatTreeDefinition.push(tree);
              const ScheduledComponent = getOrCreateScheduledText(tree);
              return (
                <Suspense fallback={<Text text={`Loading ${tree}`} />}>
                  <ScheduledComponent />
                </Suspense>
              );
            }
            // We are rendering a SuspenseList
            return (
              <SuspenseList revealOrder="together">
                {tree.map(subTree => buildComponentsTree(subTree))}
              </SuspenseList>
            );
          };
          const componentsTree = buildComponentsTree(treeDefinition);

          function Foo() {
            return componentsTree;
          }

          ReactNoop.render(<Foo />);
          flushAndYieldScheduler();

          while (s.count() !== 0) {
            if (flatTreeDefinition.length === 1) {
              expect(ReactNoop).toMatchRenderedOutput(
                <span>{`Loading ${flatTreeDefinition[0]}`}</span>,
              );
            } else {
              expect(ReactNoop).toMatchRenderedOutput(
                <>
                  {flatTreeDefinition.map(label => (
                    <span>{`Loading ${label}`}</span>
                  ))}
                </>,
              );
            }
            await s.waitOne();
            flushAndYieldScheduler();
          }

          if (flatTreeDefinition.length === 1) {
            expect(ReactNoop).toMatchRenderedOutput(
              <span>{flatTreeDefinition[0]}</span>,
            );
          } else {
            expect(ReactNoop).toMatchRenderedOutput(
              <>{flatTreeDefinition.map(label => <span>{label}</span>)}</>,
            );
          }
        },
      ),
    );
  });

  it('displays each items in "forwards" order whatever the components structure', async () => {
    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    const SuspenseArb = fc.hexaString(1, 2).noShrink();
    const SuspenseListArb = fc.memo(n => {
      if (n <= 1) {
        return fc.array(SuspenseArb, 1, 3);
      }
      return fc.array(fc.oneof(SuspenseArb, SuspenseListArb()), 1, 3);
    });

    await fc.assert(
      fc.asyncProperty(
        SuspenseListArb(4),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const flatTreeDefinition = [];
          const myMap = Object.create(null);
          const getOrCreateScheduledText = label => {
            // With that trick a same promise can resolve two components at the same time
            if (myMap[label]) {
              return myMap[label];
            }
            const item = {label, done: false};
            myMap[label] = {
              ScheduledComponent: createScheduledText(
                s,
                label,
                () => (item.done = true),
              ),
              item,
            };
            return myMap[label];
          };
          const buildComponentsTree = tree => {
            if (typeof tree === 'string') {
              // We are rendering a Suspense
              const {ScheduledComponent, item} = getOrCreateScheduledText(tree);
              flatTreeDefinition.push(item);
              return (
                <Suspense fallback={<Text text={`Loading ${tree}`} />}>
                  <ScheduledComponent />
                </Suspense>
              );
            }
            // We are rendering a SuspenseList
            return (
              <SuspenseList revealOrder="forwards">
                {tree.map(subTree => buildComponentsTree(subTree))}
              </SuspenseList>
            );
          };
          const componentsTree = buildComponentsTree(treeDefinition);

          function Foo() {
            return componentsTree;
          }

          ReactNoop.render(<Foo />);
          flushAndYieldScheduler();

          while (s.count() !== 0) {
            if (flatTreeDefinition.length === 1) {
              expect(ReactNoop).toMatchRenderedOutput(
                <span>{`Loading ${flatTreeDefinition[0].label}`}</span>,
              );
            } else {
              const firstUnresolvedIdx = flatTreeDefinition.findIndex(
                item => !item.done,
              );
              expect(ReactNoop).toMatchRenderedOutput(
                <>
                  {[
                    ...flatTreeDefinition
                      .slice(0, firstUnresolvedIdx)
                      .map(item => <span>{item.label}</span>),
                    ...flatTreeDefinition
                      .slice(firstUnresolvedIdx)
                      .map(item => <span>{`Loading ${item.label}`}</span>),
                  ]}
                </>,
              );
            }
            await s.waitOne();
            flushAndYieldScheduler();
          }

          if (flatTreeDefinition.length === 1) {
            expect(ReactNoop).toMatchRenderedOutput(
              <span>{flatTreeDefinition[0].label}</span>,
            );
          } else {
            expect(ReactNoop).toMatchRenderedOutput(
              <>{flatTreeDefinition.map(item => <span>{item.label}</span>)}</>,
            );
          }
        },
      ),
    );
  });

  it('displays each items in "forwards" order whatever the components structure (tail:collapsed)', async () => {
    // WRONG TEST

    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    const SuspenseArb = fc.hexaString(1, 2).noShrink();
    const SuspenseListArb = fc.memo(n => {
      if (n <= 1) {
        return fc.array(SuspenseArb, 1, 3);
      }
      return fc.array(fc.oneof(SuspenseArb, SuspenseListArb()), 1, 3);
    });

    await fc.assert(
      fc.asyncProperty(
        SuspenseListArb(4),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const flatTreeDefinition = [];
          const myMap = Object.create(null);
          const getOrCreateScheduledText = label => {
            // With that trick a same promise can resolve two components at the same time
            if (myMap[label]) {
              return myMap[label];
            }
            const item = {label, done: false};
            myMap[label] = {
              ScheduledComponent: createScheduledText(
                s,
                label,
                () => (item.done = true),
              ),
              item,
            };
            return myMap[label];
          };
          const buildComponentsTree = tree => {
            if (typeof tree === 'string') {
              // We are rendering a Suspense
              const {ScheduledComponent, item} = getOrCreateScheduledText(tree);
              flatTreeDefinition.push(item);
              return (
                <Suspense fallback={<Text text={`Loading ${tree}`} />}>
                  <ScheduledComponent />
                </Suspense>
              );
            }
            // We are rendering a SuspenseList
            return (
              <SuspenseList revealOrder="forwards" tail="collapsed">
                {tree.map(subTree => buildComponentsTree(subTree))}
              </SuspenseList>
            );
          };
          const componentsTree = buildComponentsTree(treeDefinition);

          function Foo() {
            return componentsTree;
          }

          ReactNoop.render(<Foo />);
          flushAndYieldScheduler();

          while (s.count() !== 0) {
            const firstUnresolvedIdx = flatTreeDefinition.findIndex(
              item => !item.done,
            );
            if (firstUnresolvedIdx === 0) {
              expect(ReactNoop).toMatchRenderedOutput(
                <span>{`Loading ${flatTreeDefinition[0].label}`}</span>,
              );
            } else {
              expect(ReactNoop).toMatchRenderedOutput(
                <>
                  {[
                    ...flatTreeDefinition
                      .slice(0, firstUnresolvedIdx)
                      .map(item => <span>{item.label}</span>),
                    <span>{`Loading ${
                      flatTreeDefinition[firstUnresolvedIdx].label
                    }`}</span>,
                  ]}
                </>,
              );
            }
            await s.waitOne();
            flushAndYieldScheduler();
          }

          if (flatTreeDefinition.length === 1) {
            expect(ReactNoop).toMatchRenderedOutput(
              <span>{flatTreeDefinition[0].label}</span>,
            );
          } else {
            expect(ReactNoop).toMatchRenderedOutput(
              <>{flatTreeDefinition.map(item => <span>{item.label}</span>)}</>,
            );
          }
        },
      ),
    );
  });

  it('displays each items in "forwards" order whatever the components structure (2)', async () => {
    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    const SuspenseArb = fc.record({
      value: fc.hexaString(1, 2).noShrink(),
      firstRender: fc.boolean(),
    });
    const SuspenseListArb = fc.memo(n => {
      if (n <= 1) {
        return fc.array(SuspenseArb, 1, 3);
      }
      return fc.array(fc.oneof(SuspenseArb, SuspenseListArb()), 1, 3);
    });

    await fc.assert(
      fc.asyncProperty(
        SuspenseListArb(4),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const flatTreeDefinition = [];
          const myMap = Object.create(null);
          const getOrCreateScheduledText = label => {
            if (myMap[label]) {
              return myMap[label];
            }
            myMap[label] = createScheduledText(s, label);
            return myMap[label];
          };
          const buildComponentsTree = (tree, isFirstRender) => {
            if (!Array.isArray(tree)) {
              if (isFirstRender && !tree.firstRender) {
                return null;
              }
              // We are rendering a Suspense
              if (!isFirstRender) {
                flatTreeDefinition.push(tree.value);
              }
              const ScheduledComponent = getOrCreateScheduledText(tree.value);
              return (
                <Suspense fallback={<Text text={`Loading ${tree}`} />}>
                  <ScheduledComponent />
                </Suspense>
              );
            }
            // We are rendering a SuspenseList
            return (
              <SuspenseList revealOrder="forwards">
                {tree.map(subTree =>
                  buildComponentsTree(subTree, isFirstRender),
                )}
              </SuspenseList>
            );
          };
          const componentsTreeFirst = buildComponentsTree(treeDefinition, true);
          const componentsTreeSecond = buildComponentsTree(
            treeDefinition,
            false,
          );

          function Foo(props) {
            if (props.isFirstRender) {
              return componentsTreeFirst;
            } else {
              return componentsTreeSecond;
            }
          }

          ReactNoop.render(<Foo isFirstRender={true} />);
          flushAndYieldScheduler();

          s.scheduleSequence([
            async () => {
              ReactNoop.render(<Foo isFirstRender={false} />);
              flushAndYieldScheduler();
            },
          ]);

          while (s.count() !== 0) {
            await s.waitOne();
            flushAndYieldScheduler();
          }

          if (flatTreeDefinition.length === 1) {
            expect(ReactNoop).toMatchRenderedOutput(
              <span>{flatTreeDefinition[0]}</span>,
            );
          } else {
            expect(ReactNoop).toMatchRenderedOutput(
              <>{flatTreeDefinition.map(label => <span>{label}</span>)}</>,
            );
          }
        },
      ),
    );
  });

  it('only A', async () => {
    let A = createAsyncText('A');

    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    expect(Scheduler).toFlushAndYield([
      'Suspend! [A]',
      'Loading A',
      'Loading A',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      /*<>
        <span>Loading A</span>
      </>*/
      <span>Loading A</span>,
    );

    await A.resolve();

    expect(Scheduler).toFlushAndYield(['A']);
    expect(ReactNoop).toMatchRenderedOutput(
      /*<>
        <span>A</span>
      </>,*/
      <span>A</span>,
    );
  });

  it('only A and B', async () => {
    let A = createAsyncText('A');
    let B = createAsyncText('B');

    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    expect(Scheduler).toFlushAndYield([
      'Suspend! [A]',
      'Loading A',
      'Suspend! [B]',
      'Loading B',
      'Loading A',
      'Loading B',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );

    await A.resolve();
    await B.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });

  it('only A and B inside two-layer SuspenseList', async () => {
    let A = createAsyncText('A');
    let B = createAsyncText('B');

    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    expect(Scheduler).toFlushAndYield([
      'Suspend! [A]',
      'Loading A',
      'Suspend! [B]',
      'Loading B',
      'Loading A',
      'Loading B',
      'Loading A', // Second layer adds extra flush and yield
      'Loading B',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );

    await A.resolve();
    await B.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });

  it('only A and B (forwards)', async () => {
    spyOnDev(console, 'error');

    let A = createAsyncText('A');
    let B = createAsyncText('B');

    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <SuspenseList revealOrder="forwards" tail="collapsed">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    }
    /*
  ● ReactSuspenseList › displays each items in "forwards" order whatever the components structure (tail:collapsed)

    Property failed after 2 tests
    { seed: -425532262, path: "1:1:0:0", endOnFailure: true }
    Counterexample: [[["e9"],["9"]],Scheduler`
    -> [task#1] promise resolved with value "e9"
    -> [task#2] promise pending`]
    Shrunk 3 time(s)
    Got error: Error: expect(received).toEqual(expected) // deep equality
    */

    ReactNoop.render(<Foo />);

    expect(Scheduler).toFlushAndYield(['Suspend! [A]', 'Loading A']);
    expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>);

    await A.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'Suspend! [B]', 'Loading B']);
    expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>); // Why?

    await B.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });

  it('only A and B (forwards confirmation)', async () => {
    spyOnDev(console, 'error');

    let A = createAsyncText('A');
    let B = createAsyncText('B');

    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    expect(Scheduler).toFlushAndYield(['Suspend! [A]', 'Loading A']);
    expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>);

    await A.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'Suspend! [B]', 'Loading B']);
    expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>); // Why?

    await B.resolve();

    expect(Scheduler).toFlushAndYield(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });
});
