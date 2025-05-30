import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import methodOverride from "method-override";
import multer from "multer";
import path from "path";
import session from "express-session";
import passport from "passport";
import LocalStrategy from "passport-local";
import flash from "connect-flash";

import Post from "./models/Post.js";
import User from "./models/User.js";
import Comment from "./models/Comment.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// Middlewares
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.json());
app.set("view engine", "ejs");

// Session & Flash
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(flash());

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return done(null, false, { message: "Invalid credentials" });
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Multer for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Middleware to protect routes
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
}

// Routes
app.get("/", (req, res) => res.redirect("/posts"));

// Signup
app.get("/signup", (req, res) => res.render("signup", { messages: req.flash("error") }));

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
    req.login(user, (err) => {
      if (err) throw err;
      res.redirect("/posts");
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "Signup failed.");
    res.redirect("/signup");
  }
});

// Login
app.get("/login", (req, res) => res.render("login", { messages: req.flash("error") }));

app.post("/login",
  passport.authenticate("local", {
    successRedirect: "/posts",
    failureRedirect: "/login",
    failureFlash: true
  })
);

// Logout
app.get("/logout", (req, res) => {
  req.logout(() => res.redirect("/login"));
});

// Posts Page
app.get("/posts", ensureAuthenticated, async (req, res) => {
  const posts = await Post.find()
    .populate("author", "username")
    .populate({ path: "comments", populate: { path: "author", select: "username" } })
    .sort({ createdAt: -1 });

  res.render("posts", { posts, user: req.user });
});

// Create Post
app.get("/posts/new", ensureAuthenticated, (req, res) => {
  res.render("create");
});

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

// Like/Unlike Post
app.post("/posts/:id/like", ensureAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const userId = req.user._id;

    const index = post.likes.findIndex(id => id.equals(userId));
    if (index === -1) post.likes.push(userId);
    else post.likes.splice(index, 1);

    await post.save();
    res.redirect("/posts");
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).send("Like failed");
  }
});

// Add Comment
app.post("/posts/:id/comments", ensureAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Post not found");

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
    console.error("Comment error:", err);
    res.status(500).send("Comment failed");
  }
});

// Delete Post
app.delete("/posts/:id", ensureAuthenticated, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send("Post not found");

    if (!post.author.equals(req.user._id)) {
      return res.status(403).send("Unauthorized");
    }

    await Post.findByIdAndDelete(req.params.id);
    res.redirect("/posts");
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Delete failed");
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
