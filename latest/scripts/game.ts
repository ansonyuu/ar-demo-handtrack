import Scene from "Scene";
import Patches from "Patches";
import Diagnostics from "Diagnostics";
import Reactive from "Reactive";
import Animation from "Animation";
import Random from "Random";
import Materials from "Materials";

// Helper function for checking collisions, based on https://github.com/RokkoEffe/Creating-2D-3D-colliders-with-Scripting-Spark-AR/blob/main/README.md
function checkCollision(positionA, positionB, lengthA, lengthB) {
  return Reactive.abs(positionA.sub(positionB)).le(
    Reactive.add(lengthA.div(2), lengthB.div(2))
  );
}

// Main event
(async function () {
  // Init game
  let score = 0;
  let bestScore = 0;
  let activeTargetIndex = null;
  const screenSize = await Patches.outputs.getPoint2D("deviceSize");

  //TODO: reset drivers
  const { driver, animation } = createTimer();
  const { countdownDriver, countdownAnimation } = createCountdown();

  const targetParent = await Scene.root.findFirst("Targets");
  // Get UI elements
  const startButton = await Scene.root.findFirst("Start Button");
  const timerUI = (await Scene.root.findFirst("Timer")) as PlanarText;
  const scoreUI = (await Scene.root.findFirst("Score")) as PlanarText;
  const countdownUI = (await Scene.root.findFirst("Countdown")) as PlanarText;

  // Get text materials
  const textMaterial = await Materials.findFirst("MaterialText");

  // Get hand tracked object
  const handTarget1 = await Scene.root.findFirst("handTarget1");
  const handTarget2 = await Scene.root.findFirst("handTarget2");

  // Start game
  const startPulse = await Patches.outputs.getPulse("startGame");

  function reset() {
    startPulse.subscribe(() => {
      countdownUI.hidden = Reactive.val(false);
      let timeText = 3;

      // We don't technically have to use text here - this could be a texture
      // index of a sprite sheet or the index of which 3D Text number should be
      // visible.
      countdownUI.text = Reactive.val(timeText.toString());

      countdownUI.transform.y = countdownAnimation
        .mul(-30)
        .add(screenSize.x.div(2).sub(countdownUI.height.div(2)));
      textMaterial.opacity = countdownAnimation;

      countdownDriver.start();
      countdownDriver.onAfterIteration().subscribe((i) => {
        countdownUI.text = Reactive.val((timeText - i).toString());
      });

      countdownDriver.onCompleted().subscribe(() => {
        countdownUI.hidden = Reactive.val(true);
        startGame();
      });
    });
  }

  reset();

  function startGame() {
    targetParent.hidden = Reactive.val(false);
    startButton.hidden = Reactive.val(true);
    timerUI.hidden = Reactive.val(false);
    scoreUI.hidden = Reactive.val(false);

    // Start timer
    driver.start();

    // Monitor timer and set text value to remaining play time
    const timerSubscription = animation.monitor().subscribe((time) => {
      timerUI.text = Reactive.val(`${time.newValue.toFixed(2)}`);
    });

    // Initialize first target
    getRandomTarget();

    // Calls game loop with actual game logic
    gameLoop();
  }

  // When timer finished, unsubscribe from animation and call our game over
  // function to handle cleanup
  driver.onCompleted().subscribe(() => {
    Diagnostics.log("donezo");
    gameOver();
  });

  /**
   * Sets new random target out of available targets. If there is currently a
   * target set, will pick out of the other available ones then sets new active
   * index.
   */
  function getRandomTarget() {
    // Filter out the "last" active item so we don't target same one twice
    const nextOptions = targets.filter(
      (el, index) => index !== activeTargetIndex
    );

    // Get random item out of the remaining items
    const randomIndex = Math.floor(Random.random() * nextOptions.length);
    const activeTarget = nextOptions[randomIndex];

    // Set active target to have some sort of visible difference
    activeTarget.target.transform.scale = Reactive.point(1.5, 1.5, 1.0);

    // Update active index
    activeTargetIndex = activeTarget.originalIndex;
  }

  /**
   * Core game loop of effect. Detects collisions, sets up subscriptions.
   */
  function gameLoop() {
    for (let i = 0; i < targets.length; i++) {
      const { target } = targets[i];

      // Collisions for hand 1
      const collision1X = checkCollision(
        handTarget1.transform.x,
        target.transform.x,
        Reactive.val(0.1),
        Reactive.val(0.1)
      );
      const collision1Y = checkCollision(
        handTarget1.transform.y,
        target.transform.y,
        Reactive.val(0.1),
        Reactive.val(0.1)
      );
      const collision1 = Reactive.and(collision1X, collision1Y);

      // Hand 2...
      const collision2X = checkCollision(
        handTarget2.transform.x,
        target.transform.x,
        Reactive.val(0.1),
        Reactive.val(0.1)
      );
      const collision2Y = checkCollision(
        handTarget2.transform.y,
        target.transform.y,
        Reactive.val(0.1),
        Reactive.val(0.1)
      );
      const collision2 = Reactive.and(collision2X, collision2Y);

      targets[i].collisionSubscription1 = collision1.monitor().subscribe(() => {
        // check if current target is accepting collisions before continuing
        if (i !== activeTargetIndex) return;
        collisionCallback(target, i);
      });

      targets[i].collisionSubscription2 = collision2.monitor().subscribe(() => {
        // check if current target is accepting collisions before continuing
        if (i !== activeTargetIndex) return;
        collisionCallback(target, i);
      });
    }
  }

  /**
   * Function called when collision is detected to update patches, score and get
   * new random target.
   *
   * @param target {SceneObjectBase} - Target that was collided with.
   * @param index {number} - Index of target in original target array.
   */
  function collisionCallback(target: SceneObjectBase, index: number) {
    // Simply setting transform back to 1, this could be any animation. Please
    // improve upon this - mine is super boring
    target.transform.scale = Reactive.point(1, 1, 1);
    // Send outputs to patch editor to drive other animations
    Patches.inputs.setScalar("collidedTargetIndex", index);
    Patches.inputs.setPulse("collisionPulse", Reactive.once());

    // Update score
    score++;
    scoreUI.text = Reactive.val(score.toString());

    // after score updated, randomize which target can be targetted next
    getRandomTarget();
  }

  /**
   * Clean up and reset when game over.
   */
  function gameOver() {
    timerUI.hidden = Reactive.val(true);
    targetParent.hidden = Reactive.val(true);

    score > bestScore ? (bestScore = score) : null;
    scoreUI.text = Reactive.val(
      "Your current score is " +
        score.toString() +
        "Your best score is " +
        bestScore.toString()
    );

    // Unsubscribe our collision subscriptions if game is no longer running
    targets.forEach((target) => {
      target.collisionSubscription1.unsubscribe();
      target.collisionSubscription2.unsubscribe();
    });

    scoreUI.hidden = Reactive.val(false);
    startButton.hidden = Reactive.val(false);
    driver.reset();
    countdownDriver.reset();
    reset();
  }

  /**
   * Creates time driver, animation and returns signal to be used for arbitrary
   * animations. By setting duration (ms) and linear sampler to same value we
   * can get a countdown in seconds to monitor and subscribe to.
   */
  function createTimer(): {
    driver: TimeDriver;
    animation: ScalarSignal;
  } {
    const timeDriverParameters = {
      durationMilliseconds: 2000
    };

    // The driver controls time, can be started, stopped
    const timeDriver = Animation.timeDriver(timeDriverParameters);

    // Sampler is what controls the value returned. Here it is linear, but we
    // can add an ease in place of the samplers.linear() function if we want to
    // mess with the time or create a new animation.
    const linearSampler = Animation.samplers.linear(
      timeDriverParameters.durationMilliseconds / 1000,
      0
    );

    // Combine the above and return our animation.
    const timerAnim = Animation.animate(timeDriver, linearSampler);

    return {
      driver: timeDriver,
      animation: timerAnim
    };
  }

  /**
   * Creates a looping countdown animation. You can subscribe to each iteration
   * to drive some animation and will effectively "tick" each second.
   */
  function createCountdown(): {
    countdownDriver: TimeDriver;
    countdownAnimation: ScalarSignal;
  } {
    const timeDriverParameters = {
      durationMilliseconds: 1000,
      loopCount: 3
    };

    const countdownDriver = Animation.timeDriver(timeDriverParameters);
    const linearSampler = Animation.samplers.linear(0, 1);
    const countdownAnimation = Animation.animate(
      countdownDriver,
      linearSampler
    );

    return {
      countdownDriver,
      countdownAnimation
    };
  }
})();
