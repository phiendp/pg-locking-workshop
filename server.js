// @ts-check

const { Client, Pool } = require("pg");
const express = require("express");

const app = express();
app.use(express.json())
const port = 8080;

const pool = new Pool({
  password: "root",
  user: "root",
  host: "postgres",
});

app.get('/', (req, res) => {
  res.status(200);
  res.send('hello');
});

app.post("/reset", async (req, res, next) => {
  const client = await pool.connect()
  try {
    await client.query('TRUNCATE players')
    await client.query('UPDATE teams SET player_count = 0')
    await client.query("DELETE FROM teams WHERE name like 'RM%'")
    res.status(200)
    res.send('OK')
  } catch (e) {
    next(e)
  } finally {
    client.release()
  }
});


app.get('/player_count', async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      'SELECT id, name, player_count FROM teams WHERE name = $1',
      [req.query.team_name],
    )
    const team = rows[0]
    if (!team) throw new Error (`Team not found: ${req.query.team_name}`)
    res.status(200)
    res.send(`${team.name} (${team.id}) player_count: ${team.player_count}`)
  } catch (e) {
    next(e)
  } finally {
    client.release()
  }
})

/**
 * Request body:
 *  * name: name of the new player
 *  * team_name: name of the team the new player belongs to
 * Functions:
 *  * Create a new player record
 *  * Update the player_count of the team of that new player
 */
app.post("/players", async (req, res, next) => {
  const client = await pool.connect()
  try {
    /**
     * rows:
     *   [
     *     [id, name, player_count]
     *   ]
     */
    const { rows: team_rows } = await client.query(
      'SELECT id, name, player_count FROM teams WHERE name = $1',
      [req.body.team_name],
    )
    const team = team_rows[0]
    if (!team) throw new Error (`Team not found: ${req.body.team_name}`)

    await client.query(
      'INSERT INTO players (name, team_id) VALUES ($1, $2)',
      [req.body.name, team.id]
    )
    await client.query(
      'UPDATE teams SET player_count = $1 WHERE id = $2',
      [team.player_count + 1, team.id]
    )

    res.status(200)
    res.send('OK')
  } catch (e) {
    next(e)
  } finally {
    client.release()
  }
});

/**
 * Request body:
 *  * name: name of the new player
 *  * team_name: name of the team the new player belongs to
 * Functions:
 *  * (PLUS function) If there is no existing team with such name, create a new team record
 *  * Create a new player record
 *  * Update the player_count of the team of that player
 */
app.post("/players_plus", async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { rows: team_rows } = await client.query(
      'SELECT id, name, player_count FROM teams WHERE name = $1',
      [req.body.team_name],
    )
    let team = team_rows[0]
    if (!team) {
      const { rows: update_res } = await client.query(
        'INSERT INTO teams (name) VALUES ($1) RETURNING id, name, player_count',
        [req.body.team_name]
      )
      team = update_res[0]
    }


    await client.query(
      'INSERT INTO players (name, team_id) VALUES ($1, $2)',
      [req.body.name, team.id]
    )
    await client.query(
      'UPDATE teams SET player_count = $1 WHERE id = $2',
      [team.player_count + 1, team.id]
    )

    res.status(200)
    res.send('OK')
  } catch (e) {
    next(e)
  } finally {
    client.release()
  }
});

// Note: WIP
app.post("/move_player", async (req, res, next) => {
  const client = await pool.connect()
  const playerId = req.body.player_id
  const teamName = req.body.team_name

  try {
    await client.query("BEGIN")

    // Fetch the current player record
    const { rows: playerRows } = await client.query("SELECT * FROM players WHERE id = $1", [playerId])
    const player = playerRows[0];
    const oldTeamId = player.team_id
    if (!player) throw new Error(`Player not found: ${playerId}`)

    // Fetch the current team record
    const { rows: teamRows } = await client.query("SELECT * FROM teams WHERE name = $1", [teamName])
    const targetTeam = teamRows[0];
    if (!targetTeam) throw new Error(`Team not found: ${teamName}`)

    // Update the player record to set the new team ID
    await client.query("UPDATE players SET team_id = $1 WHERE id = $2", [targetTeam.id, playerId])

    // Update the player_count of the old team
    await client.query(
      "UPDATE teams SET player_count = player_count - 1 WHERE id = $1",
      [oldTeamId]
    );

    // Update the player_count for the new team
    await client.query("UPDATE teams SET player_count = player_count + 1 WHERE id = $1", [targetTeam.id])

    // Finish
    await client.query("COMMIT")
    res.status(200).send("OK")
  } catch (e) {
    await client.query("ROLLBACK")
    next(e)
  } finally {
    client.release()
  }
});

(async () => {
  app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
  });
})();
