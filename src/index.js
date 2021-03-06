import io from 'socket.io-client';

import * as controller from './controller';
const physicsConstants = require('./physics/constants');
const physicsObjects = require('./physics/objects');
const physics = require('./physics/physics');
const utilities = require('./utilities');
const display = require('./display');
const brain = require('./brain');

window.blueScoreDisplay = document.querySelector('#blueScore');
window.goldScoreDisplay = document.querySelector('#goldScore');
const playPauseButton = document.querySelector('#playPause');

const mainCanvas = document.querySelector('#draw');

let playing = true;
let requestId;
let multiplayerMode;
let multiplayerHost = false;
let gameUuid;
window.score = { blue: 0, gold: 0 };
const world = new physics.World(mainCanvas.width, mainCanvas.height);
display.initCanvas(mainCanvas, world);

let blueBody = new physicsObjects.AgentObject(100, 75, 'blue');
let goldBody = new physicsObjects.AgentObject(1165, 75, 'gold');
let protagonist;
let bot;

const callbacks = {
  incrementScoreForTeam,
  onDeath,
  onKill,
  onCollision,
};

function incrementScoreForTeam(teamColor) {
  window.score[teamColor] += 1;
  window.blueScoreDisplay.innerHTML = window.score['blue'];
  window.goldScoreDisplay.innerHTML = window.score['gold'];
}

function onDeath(obj) {
  obj.onDeath();
}

function onKill(obj) {
  obj.onKill();
}

function onCollision(obj) {
  obj.onCollision();
}

function debrisFromUser($event) {
  const debris = new physicsObjects.Debris($event.offsetX, $event.offsetY, 10*(Math.random()-0.5), 10*(Math.random()-0.5));
  world.push(debris);
  return debris;
}

function spawnAndEmitDebris($event) {
  const debris = debrisFromUser($event);
  socket.emit('Client payload', { debris });
}

function resume() {
  cycleOfLife();
  playing = true;
  playPauseButton.innerHTML = 'Pause';
}

function pause() {
  stop();
  playPauseButton.innerHTML = 'Play';
}

function stop() {
  window.cancelAnimationFrame(requestId);
  requestId = undefined;
  playing = false;
}

function playpause() {
  playing ? pause() : resume();
}
window.playpause = playpause;

function snapMoment(subject, other) {
  return [
    subject.pos.x,
    subject.pos.y,
    subject.vel.x,
    subject.vel.y,
    other.pos.x,
    other.pos.y,
    other.vel.x,
    other.vel.y,
    subject.kineticState.freefall,
    other.pos.x - subject.pos.x,
    other.pos.y - subject.pos.y,
  ];
}

function snapMomentAsObject(subject, other) {
  return {
    selfPosX: subject.pos.x,
    selfPosY: subject.pos.y,
    selfVelX: subject.vel.x,
    selfVelY: subject.vel.y,
    otherPosX: other.pos.x,
    otherPosY: other.pos.y,
    otherVelX: other.vel.x,
    otherVelY: other.vel.y,
    selfFreefall: subject.kineticState.freefall,
    relativePosX: other.pos.x - subject.pos.x,
    relativePosY: other.pos.y - subject.pos.y,
    walkingDirection: subject.walkingDirection,
  };
}

function actionSnapshot(subject) {
  return {
    walkingDirection: subject.walkingDirection,
    jumping: subject.jumping
  };
}

let brainDebounceCycles = 12;
let currentCycle = 0;

function cycleOfLife() {
  if (!multiplayerMode && currentCycle == brainDebounceCycles) {
    currentCycle = 0;
    brain.botBrainCycle(world);
  }
  if (multiplayerMode) {
    const actionsToEmit = { walkingDirection: brain.localPlayerAgent.body.actions.walkingDirection };
    if (brain.localPlayerAgent.body.actions.jumping) { actionsToEmit['jumping'] = true; }
    socket.emit('Client payload', { actions: [brain.localPlayerAgent.body.actions] });
  }
  currentCycle += 1;

  world.physicsCycle(callbacks);

  brain.agents.forEach((agent) => {
    agent.body.actions.jumping = false;
  });

  requestId = requestAnimFrame(cycleOfLife);
  if (multiplayerHost) { socket.emit('Host payload', { 'allObjects': world.allObjects }); }
  display.drawWorld(physics);
}

window.addEventListener('keydown', controller.actionInput);
window.addEventListener('keyup', controller.actionStop);

function spawnMultiplayerMatch() {
  protagonist = blueBody;
  bot = goldBody;

  blueBody['pos']['x'] = 100;
  blueBody['pos']['y'] = 75;
  blueBody['vel']['x'] = 200;
  blueBody['vel']['y'] = 200;
  blueBody.kineticState.freefall = true;

  goldBody['pos']['x'] = 1165;
  goldBody['pos']['y'] = 75;
  goldBody['vel']['x'] = -200;
  goldBody['vel']['y'] = 200;
  goldBody.kineticState.freefall = true;

  world.clear();
  world.push(protagonist);
  world.push(bot);
}

let socket;

function terminateGame() {
  if (socket) { socket.close(); }
  brain.agents = [];
  world.clear();
  mainCanvas.removeEventListener('click', debrisFromUser);
  mainCanvas.removeEventListener('click', spawnAndEmitDebris);
  stop();
}

function startMultiplayerGame() {
  terminateGame();
  multiplayerMode = false;
  multiplayerHost = true;
  playPauseButton.disabled = true;
  brain.localPlayerAgent.body = blueBody;
  brain.onlinePlayerAgent.body = goldBody;
  brain.agents = [brain.localPlayerAgent, brain.onlinePlayerAgent];
  gameUuid = Math.floor(Math.random() * 8999) + 1000;
  window.history.pushState({}, "", gameUuid);
  socket = io.connect({
    query: 'gameUuid=' + gameUuid.toString(),
    resource: "socket.io"
  });
  socket.on('Client payload from server', function(payload) {
    if (payload['debris']) {
      payload['debris'].map((debris) => {
        if (obj['objectType']) {
          Object.setPrototypeOf(obj, physicsObjects.objectTypes[obj['objectType']].prototype);
        }
      })
      world.push(obj);
    }
    if (payload['actions']) { brain.onlinePlayerAgent.body.actions = payload['actions'][0]; }
  });
  mainCanvas.addEventListener('click', debrisFromUser);
  playing = true;
  cycleOfLife();
  spawnMultiplayerMatch();
  window.score = { blue: 0, gold: 0 };
  console.log('Started game at:', gameUuid);
}
window.startMultiplayerGame = startMultiplayerGame;

function joinMultiplayerGame() {
  terminateGame();
  multiplayerMode = true;
  multiplayerHost = false;
  playPauseButton.disabled = true;
  brain.localPlayerAgent.body = goldBody;
  brain.onlinePlayerAgent.body = blueBody;
  brain.agents = [brain.localPlayerAgent, brain.onlinePlayerAgent];
  world.clear();
  socket = io.connect({
    query: 'gameUuid=' + gameUuid.toString(),
    resource: "socket.io"
  });
  socket.on('Host payload from server', function(payload) {
    payload['allObjects'].map((obj) => {
      world.clear();
      if (obj['objectType']) {
        Object.setPrototypeOf(obj, physicsObjects.objectTypes[obj['objectType']].prototype);
      }
      return obj;
    });
    world.allObjects = payload['allObjects'];
  });
  mainCanvas.addEventListener('click', spawnAndEmitDebris);
  playing = true;
  cycleOfLife();
  console.log('Joined multiplayer game at:', gameUuid);
}
window.joinMultiplayerGame = joinMultiplayerGame;

function startGameAgainstBot() {
  terminateGame();
  multiplayerMode = false;
  playPauseButton.disabled = false;
  mainCanvas.addEventListener('click', debrisFromUser);
  playing = true;
  brain.localPlayerAgent.body = blueBody;
  brain.sinusoidalAgent.body = goldBody;
  brain.sinusoidalAgent.enemy = blueBody;
  brain.agents = [brain.localPlayerAgent, brain.sinusoidalAgent];
  cycleOfLife();
  spawnMultiplayerMatch();
  brain.agents.push(brain.sinusoidalAgent);
  window.score = { blue: 0, gold: 0 };
}

window.requestAnimFrame = (function(callback){
  return  window.requestAnimationFrame  ||
    window.webkitRequestAnimationFrame  ||
    window.mozRequestAnimationFrame     ||
    function(callback){
      window.setTimeout(callback, 20);
    };
})();

if (window.location.pathname !== '/') {
  gameUuid = parseInt(window.location.pathname.match(/([0-9]){4}/)[0]);
  joinMultiplayerGame();
} else {
  startGameAgainstBot();
}
