import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import methodOverride from "method-override";
import multer from "multer";
import session from "express-session";
import passport from "passport";
import LocalStrategy from "passport-local";
import flash from "connect-flash";
import MongoStore from "connect-mongo";
import Post from "./models/Post.js";
import User from "./models/User.js";
import Comment from "./models/Comment.js";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// Middlewares
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.json());
app.set("view engine", "ejs");

// Session & Flash
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
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

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "blog_uploads",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 800, crop: "limit" }]
  }
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
    .populate({
      path: "comments",
      populate: { path: "author", select: "username" }
    })
    .sort({ createdAt: -1 });

  res.render("posts", { posts, user: req.user });
});


// Create Post
app.get("/posts/new", ensureAuthenticated, (req, res) => {
  res.render("create");
});

app.post("/posts", ensureAuthenticated, upload.single("image"), async (req, res) => {
  const { title, caption, hash } = req.body;
  const imagePath = req.file ? req.file.path : null;

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
  console.log(req.body);
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

    res.redirect("/posts#" + post._id); // Better UX
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
