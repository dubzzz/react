let React;
let ReactFeatureFlags;
let ReactNoop;
let Scheduler;
let Suspense;
let SuspenseList;
let fc;

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
    fc = require('fast-check');
  });

  function Text(props) {
    Scheduler.unstable_yieldValue(props.text);
    return <span>{props.text}</span>;
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

  function suspenseListArbitrary(onlyA = false) {
    const KeyArb = fc
      .hexaString(2, 2)
      .noBias()
      .noShrink();
    const SuspenseArb = fc.record({
      key: KeyArb,
      item: fc.record({
        value: fc.hexaString(1, 2).noShrink(),
        renderPhase: onlyA
          ? fc.constant('a only')
          : fc.constantFrom('both', 'a only', 'b only'),
      }),
    });
    const SuspenseListArb = fc.memo(n => {
      const InternalArb =
        n <= 1 ? SuspenseArb : fc.oneof(SuspenseArb, SuspenseListArb());
      return fc.record({
        key: KeyArb,
        item: fc.set(InternalArb, 1, 3, (a, b) => a.key === b.key),
      });
    });
    return SuspenseListArb(2);
  }
  function buildTrees(s, suspenseListProps, treeDefinition) {
    // A given component label corresponds to a single (component, promise)
    // You can see that as: Compo['label'] = import(label)
    const cacheScheduledComponents = Object.create(null);
    const getOrCreateScheduledText = label => {
      if (cacheScheduledComponents[label]) {
        return cacheScheduledComponents[label];
      }
      const item = {label, done: false};
      const markAsDone = () => (item.done = true);
      cacheScheduledComponents[label] = {
        ScheduledComponent: createScheduledText(s, label, markAsDone),
        item,
      };
      return cacheScheduledComponents[label];
    };

    // Helper function to build components corresponding to the treeDefinition
    // For both render A (aka first render) and B
    const flatDefinitionA = [];
    const flatDefinitionB = [];
    const buildOneTree = (tree, renderPhase, pathPrefix = '') => {
      const {item, key} = tree;
      if (!Array.isArray(item)) {
        if (renderPhase === 'a' && item.renderPhase === 'b only') {
          return;
        }
        if (renderPhase === 'b' && item.renderPhase === 'a only') {
          return;
        }

        // We are rendering a Suspense
        const {
          ScheduledComponent,
          item: scheduledItem,
        } = getOrCreateScheduledText(item.value);
        (renderPhase === 'a' ? flatDefinitionA : flatDefinitionB).push({
          label: scheduledItem.label,
          isResolved: () => scheduledItem.done,
          path: `${pathPrefix}${key}`,
        });
        return (
          <Suspense
            key={key}
            fallback={<Text text={`Loading ${item.value}`} />}>
            <ScheduledComponent />
          </Suspense>
        );
      }
      // We are rendering a SuspenseList
      return (
        <SuspenseList key={key} {...suspenseListProps}>
          {item.map(subTree =>
            buildOneTree(subTree, renderPhase, `${pathPrefix}${key}.`),
          )}
        </SuspenseList>
      );
    };

    return {
      FooA: buildOneTree(treeDefinition, 'a'),
      FooB: buildOneTree(treeDefinition, 'b'),
      flatDefinitionA,
      flatDefinitionB,
    };
  }

  function buildExpectedRenderedSuspense(expectedChildren) {
    if (expectedChildren.length === 0) {
      return null;
    } else if (expectedChildren.length === 1) {
      return expectedChildren[0];
    } else {
      return <>{expectedChildren}</>;
    }
  }

  it('should wait all components to be resolved before showing any in "together" mode', async () => {
    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    await fc.assert(
      fc.asyncProperty(
        suspenseListArbitrary(true),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const {FooA, flatDefinitionA} = buildTrees(
            s,
            {revealOrder: 'together'},
            treeDefinition,
          );

          function Foo() {
            return FooA;
          }

          ReactNoop.render(<Foo />);
          flushAndYieldScheduler();

          while (s.count() !== 0) {
            // Expecting all items to be displayed as loading
            // as there are stil pending components
            expect(ReactNoop).toMatchRenderedOutput(
              buildExpectedRenderedSuspense(
                flatDefinitionA.map(item => (
                  <span>{`Loading ${item.label}`}</span>
                )),
              ),
            );

            await s.waitOne();
            flushAndYieldScheduler();
          }

          // At the end all items shuld be resolved and showing data corresponding to B
          expect(ReactNoop).toMatchRenderedOutput(
            buildExpectedRenderedSuspense(
              flatDefinitionA.map(item => <span>{item.label}</span>),
            ),
          );
        },
      ),
    );
  });

  it('should display components up-to the first unresolved one as resolved, next ones should be considered unresolved in "forward" mode', async () => {
    // TODO Remove unneeded warnings:
    // > Warning: Each child in a list should have a unique "key" prop.
    spyOnDev(console, 'error');

    await fc.assert(
      fc.asyncProperty(
        suspenseListArbitrary(),
        fc.scheduler(),
        async (treeDefinition, s) => {
          const {FooA, FooB, flatDefinitionA, flatDefinitionB} = buildTrees(
            s,
            {revealOrder: 'forwards'},
            treeDefinition,
          );

          function Foo({renderPhase}) {
            if (renderPhase === 'a') {
              return FooA;
            } else {
              return FooB;
            }
          }

          let currentFlatDefinition = flatDefinitionA;
          ReactNoop.render(<Foo renderPhase="a" />);
          flushAndYieldScheduler();

          s.scheduleSequence([
            async () => {
              currentFlatDefinition = flatDefinitionB;
              ReactNoop.render(<Foo renderPhase="b" />);
              flushAndYieldScheduler();
            },
          ]);

          // Once rendered a first time, the component will never be unmount (if it still exists in the second tree)
          const renderedComponents = new Set();

          while (s.count() !== 0) {
            // Expecting all items up to the first unresolved one to be displayed as resolved
            // Expecting others to be displayed as loading
            for (let idx = 0; idx !== currentFlatDefinition.length; ++idx) {
              const item = currentFlatDefinition[idx];
              if (!item.isResolved()) {
                break;
              }
              renderedComponents.add(item.path);
            }

            expect(ReactNoop).toMatchRenderedOutput(
              buildExpectedRenderedSuspense(
                currentFlatDefinition.map(item => {
                  if (renderedComponents.has(item.path)) {
                    return <span>{item.label}</span>;
                  }
                  return <span>{`Loading ${item.label}`}</span>;
                }),
              ),
            );

            await s.waitOne();
            flushAndYieldScheduler();
          }

          // At the end all items shuld be resolved and showing data corresponding to B
          expect(ReactNoop).toMatchRenderedOutput(
            buildExpectedRenderedSuspense(
              flatDefinitionB.map(item => <span>{item.label}</span>),
            ),
          );
        },
      ),
    );
  });
});
