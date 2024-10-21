export function JoiValidatorMiddleware(schema) {
    return async (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) return res.status(400).json(`Validation failed : ${error.details[0].message}`);

        next();
    }
}
