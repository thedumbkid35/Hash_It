import express from "express";
import bodyParser from "body-parser";
import methodOverride from "method-override";
import multer from "multer";
import path from "path";
import mongoose from "mongoose";
import session from "express-session";
import passport from "passport";
import LocalStrategy from "passport-local";
import flash from "connect-flash";

import Post from "./models/Post.js";
import User from "./models/User.js";
import Comment from "./models/Comment.js";

const app = express();
const port = 3000 || process.env.port;

// --- MongoDB connection ---
mongoose.connect("mongodb+srv://suvanbalasubramaniam:Password35@cluster0.j4pc6yb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

// --- Middleware ---
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.set("view engine", "ejs");

// Session & flash
app.use(session({
  secret: "your_secret_key",  // change to env var in production
  resave: false,
  saveUninitialized: false,
}));
app.use(flash());

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

// Passport local strategy
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await User.findOne({ username: username });
    if (!user) return done(null, false, { message: "Incorrect username." });
    const isValid = await user.comparePassword(password);
    if (!isValid) return done(null, false, { message: "Incorrect password." });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Multer storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Auth protection middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

// --- Routes ---

// Home redirect to posts
app.get("/", (req, res) => {
  res.redirect("/posts");
});

// Signup routes
app.get("/signup", (req, res) => {
  res.render("signup", { messages: req.flash("error") });
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  try {
    const existing = await User.findOne({ username });
    if (existing) {
      req.flash("error", "Username already exists.");
      return res.redirect("/signup");
    }
    const user = new User({ username, password });
    await user.save();
    req.login(user, err => {
      if (err) return next(err);
      res.redirect("/posts");
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "Something went wrong.");
    res.redirect("/signup");
  }
});

// Login routes
app.get("/login", (req, res) => {
  res.render("login", { messages: req.flash("error") });
});

app.post("/login",
  passport.authenticate("local", {
    successRedirect: "/posts",
    failureRedirect: "/login",
    failureFlash: true
  })
);

// Logout
app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/login");
  });
});

// Show posts (protected)
app.get("/posts", ensureAuthenticated, async (req, res) => {
  const posts = await Post.find()
    .populate("author", "username")
    .populate({
      path: "comments",
      populate: { path: "author", select: "username" }
    })
    .sort({ createdAt: -1 });

  res.render("posts", { posts, user: req.user });
});


// Create post form (protected)
app.get("/posts/new", ensureAuthenticated, (req, res) => {
  res.render("create.ejs");
});

// Create post action
app.post("/posts", ensureAuthenticated, upload.single("image"), async (req, res) => {
  const { title, caption, hash } = req.body;
  const imagePath = req.file ? "/uploads/" + req.file.filename : null;

  const newPost = new Post({
    title,
    caption,
    hash,
    image: imagePath,
    author: req.user._id
  });
  await newPost.save();
  res.redirect("/posts");
});

app.post("/posts/:id/comments", ensureAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      req.flash("error", "Post not found.");
      return res.redirect("/posts");
    }

    const comment = new Comment({
      content: req.body.content,
      author: req.user._id,
      post: post._id
    });

    await comment.save();

    post.comments.push(comment._id);
    await post.save();

    res.redirect("/posts");
  } catch (err) {
    console.error("Error adding comment:", err);
    res.status(500).send("Server error");
  }
});

// Delete post (only author) - protected
app.delete("/posts/:id", async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.redirect("/posts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error deleting post.");
  }
});


app.post("/posts/:id/like", ensureAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).send("Post not found");
    }

    const userId = req.user._id;
    const likedIndex = post.likes.findIndex((id) => id.equals(userId));

    if (likedIndex === -1) {
      post.likes.push(userId); // Add like
      
    } else {
      post.likes.splice(likedIndex, 1); // Remove like (toggle)
    }

    await post.save();
    res.redirect("/posts");
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

// --- Start server ---
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
