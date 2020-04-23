let React;
let ReactFeatureFlags;
let ReactNoop;
let Scheduler;
let Suspense;
let fc;

const beforeEachAction = () => {
  jest.resetModules();
  ReactFeatureFlags = require('shared/ReactFeatureFlags');
  ReactFeatureFlags.replayFailedUnitOfWorkWithInvokeGuardedCallback = false;
  ReactFeatureFlags.enableSuspenseServerRenderer = true;
  React = require('react');
  ReactNoop = require('react-noop-renderer');
  Scheduler = require('scheduler');
  Suspense = React.Suspense;
  fc = require('fast-check');
};

describe('ReactSuspense', () => {
  beforeEach(beforeEachAction);

  function Text({text}) {
    return <span>{text}</span>;
  }

  function AsyncText({text, readOrThrow}) {
    readOrThrow(text);
    return <span>{text}</span>;
  }

  function flushAndYieldScheduler() {
    Scheduler.unstable_flushAllWithoutAsserting();
    Scheduler.unstable_clearYields();
  }

  it('should display components up-to the first unresolved one as resolved, next ones should be considered unresolved in "forward" mode', async () => {
    await fc.assert(
      fc
        .asyncProperty(
          // Scheduler able to re-order operations
          fc.scheduler(),
          // The initial text defined in the App component
          fc.stringOf(fc.hexa()),
          // Array of updates with the associated priority
          fc.array(
            fc.record({
              // Priority of the task
              priority: fc.constantFrom(
                Scheduler.unstable_ImmediatePriority,
                Scheduler.unstable_UserBlockingPriority,
                Scheduler.unstable_NormalPriority,
                Scheduler.unstable_IdlePriority,
                Scheduler.unstable_LowPriority,
              ),
              // Value to set for text
              text: fc.stringOf(fc.hexa()),
            }),
          ),
          // The code under test
          async (s, initialText, textUpdates) => {
            // We simulate a cache: string -> Promise
            // It may contain successes and rejections
            const cache = new Map();
            const readOrThrow = text => {
              if (cache.has(text)) {
                // The text has already been queried
                const {promise, resolvedWith} = cache.get(text);
                // Not resolved yet?
                if (resolvedWith === null) throw promise;
                // Resolved with error?
                if (resolvedWith.error) throw resolvedWith.error;
                // Success
                return text;
              } else {
                // Not yet queried
                const promise = s.schedule(
                  Promise.resolve(),
                  `Request for ${JSON.stringify(text)}`,
                );
                const cachedValue = {promise, resolvedWith: null};
                promise.then(
                  success => (cachedValue.resolvedWith = {success}),
                  error => (cachedValue.resolvedWith = {error}),
                );
                cache.set(text, cachedValue);
                throw promise;
              }
            };

            let setText;
            function App() {
              const [text, _setText] = React.useState(initialText);
              setText = _setText;
              return <AsyncText text={text} readOrThrow={readOrThrow} />;
            }

            // Initial render
            ReactNoop.render(
              <Suspense fallback={<Text text="Loading..." />}>
                <App />
              </Suspense>,
            );
            flushAndYieldScheduler();
            expect(ReactNoop).toMatchRenderedOutput(<span>Loading...</span>);

            // Schedule updates into the scheduler
            // Updates will not be reordered
            // BUT promises that they may trigger may be scheduled in-between
            s.scheduleSequence(
              textUpdates.map(update => {
                return {
                  label: `Scheduling ${JSON.stringify(
                    update.text,
                  )} with priority ${update.priority}`,
                  builder: async () =>
                    Scheduler.unstable_runWithPriority(update.priority, () => {
                      setText(update.text);
                    }),
                };
              }),
            );

            // Exhaust the queue of scheduled tasks
            while (s.count() !== 0) {
              await ReactNoop.act(async () => {
                await s.waitOne();
                flushAndYieldScheduler();
              });
            }

            // Check the final value is the expected one
            const lastText =
              textUpdates.length > 0
                ? textUpdates[textUpdates.length - 1].text
                : initialText;
            expect(ReactNoop).toMatchRenderedOutput(<span>{lastText}</span>);
          },
        )
        .beforeEach(beforeEachAction),
      {verbose: 2},
    );
  });
});
