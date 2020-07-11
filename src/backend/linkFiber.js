import 'core-js';
/* eslint-disable indent */
/* eslint-disable brace-style */
/* eslint-disable comma-dangle */
/**
 * This file contains core module functionality.
 *
 * It exports an anonymous
 * @function
 * that is invoked on
 * @param snap --> Current snapshot
 * @param mode --> Current mode (jumping i.e. time-traveling, locked, or paused)
 * and @returns a function to be invoked by index.js to initiate snapshot monitoring
 *
 * @function updateSnapShotTree
 * --> Middleware #1: Updates snap object with latest snapshot
 *
 * @function sendSnapshot
 * --> Middleware #2: Gets a copy of the current snap.tree and posts a message to the window
 *
 * @function traverseHooks
 * @param memoizedState : memoizedState property on a stateful fctnl component's FiberNode object
 * --> Helper function to traverse through memoizedState
 * --> Invokes @changeUseState on each stateful functional component
 *
 * @function createTree
 * @param currentFiber : a FiberNode object
 * --> Recursive function to traverse from FiberRootNode and create
 *     an instance of custom Tree class and build up state snapshot
 */

/* eslint-disable no-underscore-dangle */
/* eslint-disable func-names */
/* eslint-disable no-use-before-define */
/* eslint-disable no-param-reassign */

// const Tree = require('./tree').default;
// const componentActionsRecord = require('./masterState');
//import acorn from './acorn'; // javascript parser
//import jsx from './acorn-jsx';
import Tree from './tree';
import componentActionsRecord from './masterState';
import { throttle, getHooksNames } from './helpers';

let doWork = true;

// const DEBUG_MODE = false;

// const alwaysLog = console.log;

// console.log = (original => { 
//   return (...args) => {
//     if (DEBUG_MODE) original(...args);
//   }
// })(console.log);


const circularComponentTable = new Set();

// module.exports = (snap, mode) => {
export default (snap, mode) => {
  let fiberRoot = null;

  function sendSnapshot() {
    // Don't send messages while jumping or while paused

    if (mode.jumping || mode.paused) return;

    if (!snap.tree) {
      snap.tree = new Tree('root', 'root');
    }
    const payload = snap.tree.cleanTreeCopy();// snap.tree.getCopy();

    // try {
      // await window.postMessage({
      window.postMessage({
        action: 'recordSnap',
        payload,
      });
    // } catch (e) {
    //   console.log('failed to send postMessage:', e);
    // }
  }

  // Carlos: Injects instrumentation to update our state tree every time
  // a hooks component changes state
  function traverseHooks(memoizedState) {
    const hooksStates = [];
    while (memoizedState && memoizedState.queue) {
      // Carlos: these two are legacy comments, we should look into them later
      // prevents useEffect from crashing on load
      // if (memoizedState.next.queue === null) { // prevents double pushing snapshot updates
      // console.log('traverse hooks memoizedState', memoizedState);
      if (memoizedState.memoizedState) {
        hooksStates.push({
          component: memoizedState.queue,
          state: memoizedState.memoizedState,
        });
      }
      memoizedState = memoizedState.next !== memoizedState
        ? memoizedState.next : null;
    }
    return hooksStates;
  }

  // Carlos: This runs after EVERY Fiber commit. It creates a new snapshot,
  //

  let ctRunning = 0;
  function createTree(currentFiber, tree = new Tree('root', 'root'), fromSibling = false) {
    // Base case: child or sibling pointed to null
    if (!currentFiber) return null;
    if (!tree) return tree;

    // These have the newest state. We update state and then
    // called updateSnapshotTree()
    const {
      sibling,
      stateNode,
      child,
      memoizedState,
      elementType,
      tag,
      actualDuration,
      actualStartTime,
      selfBaseDuration,
      treeBaseDuration,
    } = currentFiber;

    let newState = null;
    let componentData = {};
    let componentFound = false;

    // Check if node is a stateful setState component
    if (stateNode && stateNode.state && (tag === 0 || tag === 1 || tag === 2)) {
      // Save component's state and setState() function to our record for future
      // time-travel state changing. Add record index to snapshot so we can retrieve.
      componentData.index = componentActionsRecord.saveNew(stateNode.state, stateNode);
      newState = stateNode.state;
      componentFound = true;
    }

    // Check if node is a hooks useState function
    let hooksIndex;
    if (memoizedState && (tag === 0 || tag === 1 || tag === 2 || tag === 10)) {
      if (memoizedState.queue) {
        // Hooks states are stored as a linked list using memoizedState.next,
        // so we must traverse through the list and get the states.
        // We then store them along with the corresponding memoizedState.queue,
        // which includes the dispatch() function we use to change their state.
        const hooksStates = traverseHooks(memoizedState);
        const hooksNames = getHooksNames(elementType.toString());
        // console.log('hooks names:', hooksNames);
        hooksStates.forEach((state, i) => {
          hooksIndex = componentActionsRecord.saveNew(state.state, state.component);
          if (newState && newState.hooksState) {
            newState.hooksState.push([{ [hooksNames[i]]: state.state }, hooksIndex]);
          } else if (newState) {
            newState.hooksState = [{ [hooksNames[i]]: state.state }, hooksIndex];
          } else {
            newState = { hooksState: [{ [hooksNames[i]]: state.state }, hooksIndex] };
          }
          componentFound = true;
          // console.log('currentFiber of hooks state:', currentFiber);
        });
      }
    }

    // This grabs stateless components
    
    if (!componentFound && (tag === 0 || tag === 1 || tag === 2)) {
      newState = 'stateless';
    }

    // Adds performance metrics to the component data
    componentData = {
      ...componentData,
      actualDuration,
      actualStartTime,
      selfBaseDuration,
      treeBaseDuration,
    };

    let newNode = null;
    if (componentFound || newState === 'stateless') {
      if (fromSibling) {
        newNode = tree.addSibling(newState,
          elementType ? elementType.name : 'nameless',
          componentData);
      } else {
        newNode = tree.addChild(newState,
          elementType ? elementType.name : 'nameless',
          componentData);
      }
    } else {
      newNode = tree;
    }

    // Recurse on children
    
    if (child && !circularComponentTable.has(child)) {
      // If this node had state we appended to the children array,
      // so attach children to the newly appended child.
      // Otherwise, attach children to this same node.
      circularComponentTable.add(child);
      createTree(child, newNode);
    }
    // Recurse on siblings
    if (sibling && !circularComponentTable.has(sibling)) {
      circularComponentTable.add(sibling);
      createTree(sibling, newNode, true);
    }

    if (circularComponentTable.has(child)) {
      // console.log('found circular child, exiting tree loop');
    }

    if (circularComponentTable.has(sibling)) {
      // console.log('found circular sibling, exiting tree loop');
    }

    return tree;
  }

  function updateSnapShotTree() {
    if (fiberRoot) {
      const { current } = fiberRoot;
      circularComponentTable.clear();
      snap.tree = createTree(current);
    }
    sendSnapshot();
  }

  function handleVisibilityChange() {
    doWork = !document.hidden;
    console.log('setting doWork to:', doWork);
  }

  return async () => {    
/*     const container = document.getElementById('root');
    if (container._internalRoot) {
      fiberRoot = container._internalRoot;
    } else {
      const {
        _reactRootContainer: { _internalRoot },
        _reactRootContainer,
      } = container;
      // Only assign internal root if it actually exists
      fiberRoot = _internalRoot || _reactRootContainer;
    }
 */
    const devTools = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const reactInstance = devTools ? devTools.renderers.get(1) : null;
    fiberRoot = devTools.getFiberRoots(1).values().next().value;
    const throttledUpdateSnapshot = throttle(updateSnapShotTree, 250);
    // console.log('fiberRoot:', fiberRoot);

    // Add handler to stop gathering data when window is out of focus
    document.addEventListener('visibilitychange', handleVisibilityChange, false);

    if (reactInstance && reactInstance.version) {
      devTools.onCommitFiberRoot = (function (original) {
        return function (...args) {
          fiberRoot = args[1];
          if (doWork) throttledUpdateSnapshot();
          return original(...args);
        };
      }(devTools.onCommitFiberRoot));
    }

    if (doWork) throttledUpdateSnapshot();

    // updateSnapShotTree();
    // Send the initial snapshot once the content script has started up
    // This message is sent from contentScript.js in chrome extension bundles
    // window.addEventListener('message', ({ data: { action } }) => {
    //   if (action === 'contentScriptStarted') {
    //     // console.log('content script started received at linkFiber.js')
    //     sendSnapshot();
    //   }
    // });
  };
};
