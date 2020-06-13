const LocalizedStrings = require(process.cwd() + '/localization/LocalizedStrings.js');
const Logger = require(process.cwd() + '/server/logging/Logger.js');
const FastestFingerSession = require(process.cwd() + '/server/question/FastestFingerSession.js');
const HotSeatSession = require(process.cwd() + '/server/question/HotSeatSession.js');
const ServerState = require(process.cwd() + '/server/game/ServerState.js');
const StepDialog = require(process.cwd() + '/server/game/StepDialog.js');

const FINAL_ANSWER_WAIT_TIMES = require(process.cwd() + '/server/question/Question.js').FINAL_ANSWER_WAIT_TIMES;
const CORRECT_WAIT_TIMES = require(process.cwd() + '/server/question/Question.js').CORRECT_WAIT_TIMES;
const MONEY_STRINGS = require(process.cwd() + '/server/question/Question.js').MONEY_STRINGS;

// Socket event names to allow for dynamic activation and deactivation of listeners.
const SOCKET_EVENTS = [
  'showHostShowFastestFingerRules',
  'showHostCueFastestFingerQuestion',
  'showHostShowFastestFingerQuestionText',
  'showHostCueFastestFingerThreeStrikes',
  'showHostRevealFastestFingerQuestionChoices',
  'contestantFastestFingerChoose',
  'fastestFingerTimeUp',
  'showHostCueFastestFingerAnswerRevealAudio',
  'showHostRevealFastestFingerAnswer',
  'showHostRevealFastestFingerResults',
  'showHostAcceptHotSeatPlayer',
  'showHostCueHotSeatRules',
  'showHostHighlightLifeline',
  'showHostCueHotSeatQuestion',
  'showHostShowHotSeatQuestionText',
  'showHostRevealHotSeatChoice',
  'showHostAskTheAudience',
  'showHostDoFiftyFifty',
  'showHostPhoneAFriend',
  'showHostRevealHotSeatQuestionVictory',
  'showHostRevealHotSeatQuestionLoss',
  'showHostShowScores',
  'contestantChoose',
  'contestantSetConfidence',
  'hotSeatChoose',
  'hotSeatFinalAnswer',
  'hotSeatUseLifeline',
  'hotSeatConfirmLifeline',
  'hotSeatPickPhoneAFriend',
];

// Handles game-related socket interactions on the server side.
class GameServer {

  constructor(playerMap) {
    // PlayerMap of the game.
    this.playerMap = playerMap;

    // ServerState of this game.
    this.serverState = undefined;

    // FastestFingerSession which can keep generating unused questions for this server.
    this.fastestFingerSession = new FastestFingerSession();

    // HotSeatSession which can keep generating unused questions for this server.
    this.hotSeatSession = new HotSeatSession();

    // Reference to a setTimeout function that is forced upon the GameServer.
    this.currentForcedTimer = undefined;

    // Whatever socket event was last listened to. Stored so people who left can rejoin without a
    // problem.
    this.currentSocketEvent = undefined;
  }


  // PRIVATE METHODS

  // Returns a one-choice StepDialog for the host that steps to the next socket event expected, or
  // sets a timer to trigger that same expected socket.
  //
  // Expected data format {
  //   string nextSocketEvent
  //   string hostButtonMessage
  //   string aiTimeout
  // }
  _getOneChoiceHostStepDialog(data) {
    // Human host will control flow, or timeout will automatically step the game
    if (this.serverState.playerShowHostPresent()) {
      return new StepDialog(/*actions=*/[{
        socketEvent: data.nextSocketEvent,
        text: data.hostButtonMessage
      }]);
    } else {
      return new StepDialog(
        /*actions=*/[],
        /*timeoutFunc=*/() => {
          this[data.nextSocketEvent]({}, data.nextSocketEvent)
        },
        /*timeoutMs=*/data.aiTimeout);
    }
  }

  // Returns a new manual StepDialog that prompts the user with a yes or no option.
  _getYesNoDialog(yesEvent, noEvent, header) {
    return new StepDialog(/*actions=*/[
      {
        socketEvent: yesEvent,
        text: LocalizedStrings.YES
      },
      {
        socketEvent: noEvent,
        text: LocalizedStrings.NO
      }],
      /*timeoutFunc=*/undefined,
      /*timeoutMs*/undefined,
      /*header=*/header);
  }

  // Updates the game client-side by emitting a customized, compressed ClientState to each player.
  _updateGame() {
    this.playerMap.emitCustomToAll('updateGame', (socket) => {
      return this.serverState.toCompressedClientState(socket, this.currentSocketEvent);
    });
  }


  // PUBLIC METHODS

  // Activates all game-related socket listeners for the given socket.
  activateListenersForSocket(socket) {
    SOCKET_EVENTS.forEach((socketEvent, index) => {
      socket.on(socketEvent, (data) => { this[socketEvent](socket, data) });
    });
  }

  // Deactivates all game-related socket listeners for the given socket.
  deactivateListenersForSocket(socket) {
    SOCKET_EVENTS.forEach((socketEvent, index) => {
      socket.removeAllListeners(socketEvent);
    });
  }

  // Ends the game for this GameServer.
  endGame() {
    // All timers must be cleared to prevent against server crashes during prematurely ended games.
    if (this.serverState !== undefined) {
      this.serverState.clearTimers();
      clearTimeout(this.currentForcedTimer);
    }

    this.serverState = undefined;
    this.playerMap.removeInactivePlayers();
    this.playerMap.doAll((player) => { player.reset(); });
  }

  // Returns whether the given game options are valid.
  gameOptionsAreValid(gameOptions) {
    return gameOptions.showHostUsername === undefined || this.playerMap.getActivePlayerCount() > 1;
  }

  // Returns whether the GameServer is ingame.
  isInGame() {
    return this.serverState !== undefined;
  }

  // Starts the game for this GameServer.
  startGame(gameOptions) {
    this.serverState = new ServerState(this.playerMap);
    this.serverState.setShowHostByUsername(gameOptions.showHostUsername);
    this.serverState.startNewRound();
    this.showHostShowFastestFingerRules();
  }

  // Updates the game solely for the given socket.
  updateGameForSocket(socket) {
    socket.emit('updateGame',
      this.serverState.toCompressedClientState(socket, this.currentSocketEvent));
  }


  // SOCKET LISTENERS

  // Response to client asking to show fastest finger rules.
  showHostShowFastestFingerRules(socket, data) {
    this.currentSocketEvent = 'showHostShowFastestFingerRules';
    Logger.logInfo(this.currentSocketEvent);

    // This is the first part of any game, so we start a new round for the server state
    this.serverState.startNewRound();

    // Human host will control flow, or 5 seconds are allotted for the rules to be shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueFastestFingerQuestion',
      hostButtonMessage: LocalizedStrings.CUE_FASTEST_FINGER_MUSIC,
      aiTimeout: 5000
    }));
    this._updateGame();
  }

  // Response to client asking to cue the fastest finger question.
  //
  // This should not really do much other than remove any rules on the screen and do an audio cue.
  showHostCueFastestFingerQuestion(socket, data) {
    this.currentSocketEvent = 'showHostCueFastestFingerQuestion';
    Logger.logInfo(this.currentSocketEvent);

    // Human host will control flow, or 3 seconds until question text is shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostShowFastestFingerQuestionText',
      hostButtonMessage: LocalizedStrings.SHOW_FASTEST_FINGER_QUESTION,
      aiTimeout: 3000
    }));
    this._updateGame();
  }

  // Response to client asking to show fastest finger question text.
  //
  // This should query fastestFingerSession for a new question, as this is the first time
  // information from a new question is to be shown.
  showHostShowFastestFingerQuestionText(socket, data) {
    this.currentSocketEvent = 'showHostShowFastestFingerQuestionText';
    Logger.logInfo(this.currentSocketEvent);

    this.serverState.fastestFingerQuestion = this.fastestFingerSession.getNewQuestion();

    // Human host will control flow, or 8 seconds will pass until choices are revealed
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueFastestFingerThreeStrikes',
      hostButtonMessage: LocalizedStrings.REVEAL_FASTEST_FINGER_CHOICE,
      aiTimeout: 8000
    }));
    this._updateGame();
  }

  // Response to client asking to cue the three strikes audio for fastest finger.
  showHostCueFastestFingerThreeStrikes(socket, data) {
    this.currentSocketEvent = 'showHostCueFastestFingerThreeStrikes';
    Logger.logInfo(this.currentSocketEvent);

    // First we cue the audio with no possible host step action.
    this.serverState.setShowHostStepDialog(undefined);
    this._updateGame();

    // After a small waiting period, we reveal all choices.
    this.currentForcedTimer = setTimeout(() => {
      this.showHostRevealFastestFingerQuestionChoices(data);
    }, /*timeoutMs*/2500);
  }

  // Response to client asking to reveal fastest finger choices.
  showHostRevealFastestFingerQuestionChoices(socket, data) {
    this.currentSocketEvent = 'showHostRevealFastestFingerQuestionChoices';
    Logger.logInfo(this.currentSocketEvent);

    this.serverState.fastestFingerQuestion.revealAllChoices();
    this.serverState.fastestFingerQuestion.markStartTime();
    this._updateGame();

    this.currentForcedTimer = setTimeout(() => {
      this.fastestFingerTimeUp(data);
    }, /*timeoutMs*/10000);
  }

  // Response to contestant from client locking in a fastest finger choice.
  //
  // Expected data format: {
  //   Choice choice
  // }
  contestantFastestFingerChoose(socket, data) {
    Logger.logInfo('contestantFastestFingerChoose: ' + data.choice);

    var player = this.playerMap.getPlayerBySocket(socket);
    player.chooseFastestFinger(data.choice);
    this.updateGameForSocket(socket);

    if (this.serverState.allPlayersDoneWithFastestFinger()) {
      this.fastestFingerTimeUp(socket, data);
    }
  }

  // Response to client reaching the end of fastest finger.
  //
  // Can be triggered before timer runs out by everyone getting in answers.
  fastestFingerTimeUp(socket, data) {
    this.currentSocketEvent = 'fastestFingerTimeUp';
    Logger.logInfo(this.currentSocketEvent);

    // Even if this was triggered by the timeout expiring, we will be safe and clear the timeout, as
    // it may have been triggered by everyone answering.
    clearTimeout(this.currentForcedTimer);

    // Human host will control flow, or 8 seconds will pass until choices are revealed
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueFastestFingerAnswerRevealAudio',
      hostButtonMessage: LocalizedStrings.CUE_FASTEST_FINGER_ANSWER_REVEAL_AUDIO,
      aiTimeout: 2500
    }));
    this._updateGame();
  }

  // Response to client asking to cue fastest finger reveal background audio.
  showHostCueFastestFingerAnswerRevealAudio(socket, data) {
    this.currentSocketEvent = 'showHostCueFastestFingerAnswerRevealAudio';
    Logger.logInfo(this.currentSocketEvent);

    // Human host will control flow, or 2.5 seconds until question text is shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostRevealFastestFingerAnswer',
      hostButtonMessage: LocalizedStrings.REVEAL_FASTEST_FINGER_ANSWER,
      aiTimeout: 2500
    }));
    this._updateGame();
  }

  // Response to client asking to reveal a fastest finger answer.
  showHostRevealFastestFingerAnswer(socket, data) {
    this.currentSocketEvent = 'showHostRevealFastestFingerAnswer';
    Logger.logInfo(this.currentSocketEvent);

    this.serverState.fastestFingerQuestion.revealAnswer();

    if (this.serverState.fastestFingerQuestion.revealedAllAnswers()) {
      // If all answers are revealed, move on to the results.
      this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
        nextSocketEvent: 'showHostRevealFastestFingerResults',
        hostButtonMessage: LocalizedStrings.REVEAL_FASTEST_FINGER_RESULTS,
        aiTimeout: 2000
      }));
    } else {
      // Otherwise, repeat the same logic.
      this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
        nextSocketEvent: 'showHostRevealFastestFingerAnswer',
        hostButtonMessage: LocalizedStrings.REVEAL_FASTEST_FINGER_ANSWER,
        aiTimeout: 2000
      }));
    }
    this._updateGame();
  }

  // Response to client asking to reveal fastest finger results.
  showHostRevealFastestFingerResults(socket, data) {
    this.currentSocketEvent = 'showHostRevealFastestFingerResults';
    Logger.logInfo(this.currentSocketEvent);

    // Grade every answer; the winner will be determined by whoever gets the highest score.
    // Tiebreaker is on answer time.
    this.playerMap.doAll((player) => {
      player.fastestFingerScore = this.serverState.fastestFingerQuestion.getAnswerScore(
        player.fastestFingerChoices);
    });

    // Human host will control flow, or 3 seconds until hot seat player is accepted.
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostAcceptHotSeatPlayer',
      hostButtonMessage: LocalizedStrings.ACCEPT_HOT_SEAT_PLAYER,
      aiTimeout: 3000
    }));
    this._updateGame();
  }

  // Response to client asking to accept the hot seat player.
  //
  // This is a celebration screen where fanfare should play.
  showHostAcceptHotSeatPlayer(socket, data) {
    this.currentSocketEvent = 'showHostAcceptHotSeatPlayer';
    Logger.logInfo(this.currentSocketEvent);

    // Fanfare should play as the celebration for a fastest finger winner is started.
    this.serverState.setCelebrationBanner({
      header: LocalizedStrings.FASTEST_FINGER_WINNER,
      text: this.serverState.hotSeatPlayer.username
    });

    // Human host will control flow, or 10 seconds until hot seat rules start.
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueHotSeatRules',
      hostButtonMessage: LocalizedStrings.SHOW_HOT_SEAT_RULES,
      aiTimeout: 10000
    }));
    this._updateGame();
  }

  // Response to client asking to show hot seat rules to all players.
  //
  // This should not really do much other than show text on screen and do an audio cue.
  showHostCueHotSeatRules(socket, data) {
    this.currentSocketEvent = 'showHostCueHotSeatRules';
    Logger.logInfo(this.currentSocketEvent);

    // Fastest finger question is reset, as its job is finished. The celebration banner is removed
    // as well.
    this.serverState.resetFastestFinger();
    this.serverState.setCelebrationBanner(undefined);

    // Human host will control flow, or 5 seconds until question text is shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueHotSeatQuestion',
      hostButtonMessage: LocalizedStrings.CUE_HOT_SEAT_QUESTION,
      aiTimeout: 5000
    }));
    this._updateGame();
  }

  // Response to client asking to show cue a hot seat question.
  showHostCueHotSeatQuestion(socket, data) {
    this.currentSocketEvent = 'showHostCueHotSeatQuestion';
    Logger.logInfo(this.currentSocketEvent);

    // Nothing much happens here other than triggering the "Let's Play" audio cue.
    this.serverState.setCelebrationBanner(undefined);
    this.serverState.hotSeatQuestionIndex++;

    // Human host will control flow, or 7 seconds until question text is shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostShowHotSeatQuestionText',
      hostButtonMessage: LocalizedStrings.SHOW_HOT_SEAT_QUESTION,
      aiTimeout: 7000
    }));
    this._updateGame();
  }

  // Response to the client asking to show hot seat question text.
  showHostShowHotSeatQuestionText(socket, data) {
    this.currentSocketEvent = 'showHostShowHotSeatQuestionText';
    Logger.logInfo(this.currentSocketEvent);

    // Get a new hot seat question, because this is the first we so of it.
    this.serverState.hotSeatQuestion = this.hotSeatSession.getNewQuestion(
      this.serverState.hotSeatQuestionIndex);

    // Human host will control flow, or 4 seconds until question text is shown
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostRevealHotSeatChoice',
      hostButtonMessage: LocalizedStrings.REVEAL_HOT_SEAT_CHOICE,
      aiTimeout: 4000
    }));
    this._updateGame();
  }

  // Response to the client asking to show hot seat question text.
  showHostRevealHotSeatChoice(socket, data) {
    this.currentSocketEvent = 'showHostRevealHotSeatChoice';
    Logger.logInfo(this.currentSocketEvent);

    // We clear hot seat player's answer just for if they back out of final answer.
    this.serverState.hotSeatPlayer.clearAllAnswers();
    this.serverState.hotSeatQuestion.revealChoice();

    // Only reveal more choices if choices are left.
    if (!this.serverState.hotSeatQuestion.allChoicesRevealed()) {
      this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
        nextSocketEvent: 'showHostRevealHotSeatChoice',
        hostButtonMessage: LocalizedStrings.REVEAL_HOT_SEAT_CHOICE,
        aiTimeout: 1500
      }));
    } else {
      // Once all choices are revealed, start the clock for timing contestant answers.
      this.serverState.hotSeatQuestion.markStartTime();
      // Once all choices are revealed, the show host must wait for hot seat player input.
      this.serverState.setShowHostStepDialog(undefined);
      this.serverState.setHotSeatStepDialog(undefined);
    }
    this._updateGame();
  }

  // Response to the client making a hot seat choice.
  //
  // Expected to only be called by the hot seat player.
  hotSeatChoose(socket, data) {
    this.currentSocketEvent = 'hotSeatChoose';
    Logger.logInfo(this.currentSocketEvent);

    this.serverState.hotSeatPlayer.chooseHotSeat(data.choice);
    var dialog = this._getYesNoDialog(
          /*yesEvent=*/'hotSeatFinalAnswer',
          /*noEvent=*/'showHostRevealHotSeatChoice',
          /*header=*/LocalizedStrings.HOT_SEAT_FINAL_ANSWER);

    if (this.serverState.playerShowHostPresent()) {
      this.serverState.setShowHostStepDialog(dialog);
    } else {
      this.serverState.setHotSeatStepDialog(dialog);
    }
    this._updateGame();
  }

  // Response to the client making a contestant choice on a hot seat question.
  //
  // Expected to only come from contestant sockets.
  contestantChoose(socket, data) {
    Logger.logInfo('contestantChoose: ' + data.choice);

    var player = this.playerMap.getPlayerBySocket(socket);
    player.chooseHotSeat(data.choice);
    this.updateGameForSocket(socket);
  }

  // Response to the client finalizing a hot seat player's answer.
  //
  // Will reveal the outcome of the answer to the show host, but only the show host.
  hotSeatFinalAnswer(socket, data) {
    this.currentSocketEvent = 'hotSeatFinalAnswer';
    Logger.logInfo(this.currentSocketEvent);

    this.serverState.hotSeatQuestion.revealCorrectChoiceForShowHost();

    if (this.serverState.hotSeatQuestion.answerIsCorrect(
        this.serverState.hotSeatPlayer.hotSeatChoice)) {
      this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
        nextSocketEvent: 'showHostRevealHotSeatQuestionVictory',
        hostButtonMessage: LocalizedStrings.HOT_SEAT_VICTORY,
        aiTimeout: FINAL_ANSWER_WAIT_TIMES[this.serverState.hotSeatQuestionIndex]
      }));
    } else  {
      this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
        nextSocketEvent: 'showHostRevealHotSeatQuestionLoss',
        hostButtonMessage: LocalizedStrings.HOT_SEAT_LOSS,
        aiTimeout: FINAL_ANSWER_WAIT_TIMES[this.serverState.hotSeatQuestionIndex]
      }));
    }

    this._updateGame();
  }

  // Response to the client transitioning to a question victory screen.
  showHostRevealHotSeatQuestionVictory(socket, data) {
    this.currentSocketEvent = 'showHostRevealHotSeatQuestionVictory';
    Logger.logInfo(this.currentSocketEvent);

    // First we want to reveal the question's outcome briefly.
    this.serverState.setShowHostStepDialog(undefined);
    this.serverState.hotSeatQuestion.revealCorrectChoiceForAll();
    this._updateGame();

    // Then after a brief moment, set the step dialog and celebration banner.
    this.currentForcedTimer = setTimeout(() => {
      this.showHostRevealHotSeatQuestionVictory_Continuation();
    }, /*timeoutMs*/1000);
  }

  // Continuation to be forced during showHostRevealQuestionVictory.
  showHostRevealHotSeatQuestionVictory_Continuation() {
    this.serverState.setCelebrationBanner({
      header: '',
      text: MONEY_STRINGS[this.serverState.hotSeatQuestionIndex]
    });
    this.serverState.resetHotSeatQuestion();
    this.serverState.setShowHostStepDialog(this._getOneChoiceHostStepDialog({
      nextSocketEvent: 'showHostCueHotSeatQuestion',
      hostButtonMessage: LocalizedStrings.CUE_HOT_SEAT_QUESTION,
      aiTimeout: CORRECT_WAIT_TIMES[this.serverState.hotSeatQuestionIndex]
    }));
    this._updateGame();
  }
}

module.exports = GameServer;
GameServer.SOCKET_EVENTS = SOCKET_EVENTS;